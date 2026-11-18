import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Before config.ts loads: a fixed secret, so encryption never writes a .secret file.
vi.hoisted(() => {
	process.env.APP_SECRET = 'test-secret-for-notifications-0123456789';
});

import type { MonitorStatus } from '$lib/types.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { openDatabase } from '../db/index.js';
import { createMonitor, getMonitor, recordCheck } from '../db/repo/monitors.js';
import { getChannel } from '../db/repo/notifications.js';
import { checkHttp } from '../monitor/http-check.js';
import { describeNetworkError, gotifyPayload, sendGotify } from './gotify.js';
import {
	createNotificationChannel,
	NotificationInputError,
	notifyCheck,
	sendTestNotification,
	updateNotificationChannel
} from './index.js';
import { formatDuration, monitorMessage, notifyEvent } from './message.js';

describe('when to notify', () => {
	const cases: [MonitorStatus, 'up' | 'down' | 'pending', 'up' | 'down' | null, string | null][] = [
		['up', 'down', null, 'down'],
		['unknown', 'down', null, 'down'],
		['pending', 'down', 'up', 'down'],
		['pending', 'down', null, 'down'],
		['down', 'up', null, 'up'],
		['pending', 'up', 'down', 'up'],
		// Nothing new:
		['down', 'down', null, null],
		['up', 'up', null, null],
		['pending', 'down', 'down', null],
		['pending', 'up', 'up', null],
		// A monitor's first up check, and pending checks:
		['unknown', 'up', null, null],
		['pending', 'up', null, null],
		['up', 'pending', null, null],
		['down', 'pending', 'down', null],
		['paused', 'down', null, null]
	];
	it.each(cases)('%s → %s (settled before: %s) sends %s', (previous, status, settled, expected) => {
		expect(notifyEvent(previous, status, settled)).toBe(expected);
	});
});

describe('messages', () => {
	const monitor = {
		id: 'm1',
		name: 'Billing service',
		type: 'http' as const,
		url: 'https://billing.example.com/health',
		method: 'GET' as const,
		container: null
	};

	it('formats durations', () => {
		expect(formatDuration(45_000)).toBe('45s');
		expect(formatDuration(12 * 60_000)).toBe('12m');
		expect(formatDuration(3 * 3_600_000 + 5 * 60_000)).toBe('3h 5m');
		expect(formatDuration(2 * 3_600_000)).toBe('2h');
		expect(formatDuration(52 * 3_600_000)).toBe('2d 4h');
	});

	it('says what went down and where', () => {
		const msg = monitorMessage({
			monitor,
			event: 'down',
			message: 'HTTP 503 Service_Unavailable',
			latencyMs: null,
			downSince: null,
			at: 0,
			origin: 'https://status.example.com/'
		});
		expect(msg.title).toBe('🔴 Billing service is down');
		expect(msg.body).toBe(
			'HTTP 503 Service\\_Unavailable\n\n**Target:** `https://billing.example.com/health`'
		);
		expect(msg.url).toBe('https://status.example.com/monitors/m1');
	});

	it('says how long a recovered monitor was down', () => {
		const msg = monitorMessage({
			monitor: { ...monitor, type: 'docker', url: null, container: 'billing' },
			event: 'up',
			message: 'Running',
			latencyMs: 4,
			downSince: 1_000,
			at: 1_000 + 3 * 3_600_000 + 12 * 60_000,
			origin: 'https://status.example.com'
		});
		expect(msg.title).toBe('🟢 Billing service is up again');
		expect(msg.body).toBe(
			'Down for **3h 12m**.\n\nRunning · 4 ms\n\n**Target:** `Container billing`'
		);
	});

	it('builds the Gotify payload', () => {
		expect(
			gotifyPayload({ title: 'T', body: '**B**', url: 'https://s.example.com/monitors/m1' }, 8)
		).toEqual({
			title: 'T',
			message: '**B**',
			priority: 8,
			extras: {
				'client::display': { contentType: 'text/markdown' },
				'client::notification': { click: { url: 'https://s.example.com/monitors/m1' } }
			}
		});
		expect(gotifyPayload({ title: 'T', body: 'B', url: null }, 0).extras).toEqual({
			'client::display': { contentType: 'text/markdown' }
		});
	});
});

describe('Gotify errors', () => {
	it('explains network failures', async () => {
		// A port that was free a moment ago refuses connections.
		const closed = createServer();
		const url = await listen(closed);
		await new Promise((r) => closed.close(r));
		await expect(
			sendGotify({ url, token: 't', priority: 8 }, { title: 'T', body: 'B', url: null })
		).rejects.toThrow(`${new URL(url).host} refused the connection`);
		const dns = new TypeError('fetch failed', {
			cause: Object.assign(new Error('getaddrinfo ENOTFOUND push.example.com'), {
				code: 'ENOTFOUND'
			})
		});
		expect(describeNetworkError(dns, 'https://push.example.com')).toBe(
			"Couldn't find push.example.com. Check the server URL."
		);
	});
});

describe('secrets', () => {
	it('round-trips and detects tampering', () => {
		const blob = encryptSecret('AbC.123');
		expect(blob).not.toContain('AbC');
		expect(decryptSecret(blob)).toBe('AbC.123');
		const [iv, tag, data] = blob.split('.');
		const flipped = Buffer.from(data, 'base64');
		flipped[0] ^= 1;
		expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
	});
});

// A tiny Gotify and a monitored service, both on free ports.
interface Received {
	path: string;
	headers: IncomingHttpHeaders;
	body: {
		title: string;
		message: string;
		priority: number;
		extras: Record<string, Record<string, unknown>>;
	};
}

function listen(server: Server): Promise<string> {
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () =>
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		)
	);
}

describe('end to end with a mock Gotify', () => {
	const received: Received[] = [];
	let gotifyStatus = 200;
	let serviceStatus = 503;
	const gotify = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw) });
			res.writeHead(gotifyStatus, { 'content-type': 'application/json' });
			res.end(
				gotifyStatus === 200
					? JSON.stringify({ id: received.length })
					: JSON.stringify({
							error: 'Unauthorized',
							errorCode: 401,
							errorDescription: 'you need to provide a valid access token'
						})
			);
		});
	});
	const service = createServer((_req, res) => {
		res.writeHead(serviceStatus);
		res.end();
	});
	let gotifyUrl = '';
	let serviceUrl = '';

	beforeAll(async () => {
		gotifyUrl = await listen(gotify);
		serviceUrl = await listen(service);
	});
	afterAll(() => {
		gotify.close();
		service.close();
	});

	it('POSTs to Gotify when a monitor goes down and when it recovers', async () => {
		const db = openDatabase(':memory:');
		const monitor = createMonitor(
			db,
			{ name: 'Billing service', type: 'http', url: `${serviceUrl}/health`, timeoutSeconds: 5 },
			null
		);
		const channel = createNotificationChannel(db, {
			type: 'gotify',
			name: 'Phone',
			enabled: true,
			allMonitors: true,
			monitorIds: [],
			config: { url: `${gotifyUrl}/`, token: 'app-token-123', priority: 8 }
		});
		expect(channel.config).toEqual({ url: gotifyUrl, priority: 8, hasToken: true });
		const raw = db.prepare('SELECT config FROM notification_channels').get() as { config: string };
		expect(raw.config).not.toContain('app-token-123');

		// What the scheduler does for each check.
		const check = async (at: number) => {
			const fresh = getMonitor(db, monitor.id)!;
			const outcome = await checkHttp(fresh);
			const change = recordCheck(db, monitor.id, outcome, at)!;
			await notifyCheck(db, getMonitor(db, monitor.id)!, change, outcome, at, 'http://statty.test');
		};

		const t0 = Date.now();
		await check(t0);
		expect(received).toHaveLength(1);
		const down = received[0];
		expect(down.path).toBe('/message');
		expect(down.headers['x-gotify-key']).toBe('app-token-123');
		expect(down.body.title).toBe('🔴 Billing service is down');
		expect(down.body.message).toContain('HTTP 503');
		expect(down.body.message).toContain(`${serviceUrl}/health`);
		expect(down.body.priority).toBe(8);
		expect(down.body.extras['client::display']).toEqual({ contentType: 'text/markdown' });
		expect(down.body.extras['client::notification']).toEqual({
			click: { url: `http://statty.test/monitors/${monitor.id}` }
		});

		// Still down: nothing new.
		await check(t0 + 60_000);
		expect(received).toHaveLength(1);

		serviceStatus = 200;
		await check(t0 + 5 * 60_000);
		expect(received).toHaveLength(2);
		expect(received[1].body.title).toBe('🟢 Billing service is up again');
		expect(received[1].body.message).toContain('Down for **5m**');

		// Up again: nothing new.
		await check(t0 + 6 * 60_000);
		expect(received).toHaveLength(2);
		serviceStatus = 503;
	});

	it('keeps the token when an edit leaves it blank, and reports Gotify errors', async () => {
		received.length = 0;
		const db = openDatabase(':memory:');
		const monitor = createMonitor(db, { name: 'Web', type: 'http', url: serviceUrl }, null);
		const created = createNotificationChannel(db, {
			type: 'gotify',
			name: 'Desk',
			enabled: true,
			allMonitors: false,
			monitorIds: [monitor.id],
			config: { url: gotifyUrl, token: 'first-token' }
		});
		expect(created.config.priority).toBe(8);
		expect(created.monitorIds).toEqual([monitor.id]);

		const updated = updateNotificationChannel(db, created.id, {
			name: 'Desk 2',
			config: { url: gotifyUrl, token: '  ', priority: 3 }
		});
		expect(updated?.config.priority).toBe(3);
		await sendTestNotification(getChannel(db, created.id)!, 'http://statty.test');
		expect(received[0].headers['x-gotify-key']).toBe('first-token');
		expect(received[0].body.priority).toBe(3);
		expect(received[0].body.title).toBe('🔔 Test from Statty');

		gotifyStatus = 401;
		await expect(
			sendTestNotification(getChannel(db, created.id)!, 'http://statty.test')
		).rejects.toThrow('Gotify rejected the app token (401)');
		// Background sends only log.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(
			notifyCheck(
				db,
				getMonitor(db, monitor.id)!,
				{ previous: 'up', status: 'down' },
				{ message: 'HTTP 503', latencyMs: 3 },
				Date.now()
			)
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
		gotifyStatus = 200;

		// Deleting the monitor drops it from the channel's chosen set.
		db.prepare('DELETE FROM monitors WHERE id = ?').run(monitor.id);
		expect(getChannel(db, created.id)?.monitorIds).toEqual([]);
	});

	it('rejects bad channel input', () => {
		const db = openDatabase(':memory:');
		const base = {
			type: 'gotify' as const,
			name: 'X',
			enabled: true,
			allMonitors: true,
			monitorIds: []
		};
		expect(() =>
			createNotificationChannel(db, { ...base, config: { url: 'ftp://x', token: 't' } })
		).toThrow(NotificationInputError);
		expect(() => createNotificationChannel(db, { ...base, config: { url: 'https://x' } })).toThrow(
			'config.token'
		);
		expect(() =>
			createNotificationChannel(db, {
				...base,
				config: { url: 'https://x', token: 't', priority: 11 }
			})
		).toThrow('config.priority');
		expect(() =>
			createNotificationChannel(db, {
				...base,
				allMonitors: false,
				monitorIds: ['nope'],
				config: { url: 'https://x', token: 't' }
			})
		).toThrow('monitorIds');
	});

	it('skips paused channels and monitors outside the chosen set', async () => {
		received.length = 0;
		const db = openDatabase(':memory:');
		const a = createMonitor(db, { name: 'A', type: 'http', url: serviceUrl }, null);
		const b = createMonitor(db, { name: 'B', type: 'http', url: serviceUrl }, null);
		createNotificationChannel(db, {
			type: 'gotify',
			name: 'Only A',
			enabled: true,
			allMonitors: false,
			monitorIds: [a.id],
			config: { url: gotifyUrl, token: 't' }
		});
		createNotificationChannel(db, {
			type: 'gotify',
			name: 'Off',
			enabled: false,
			allMonitors: true,
			monitorIds: [],
			config: { url: gotifyUrl, token: 't' }
		});
		const down = { previous: 'up' as const, status: 'down' as const };
		const outcome = { message: 'HTTP 503', latencyMs: 1 };
		await notifyCheck(db, getMonitor(db, b.id)!, down, outcome, Date.now(), 'http://s');
		expect(received).toHaveLength(0);
		await notifyCheck(db, getMonitor(db, a.id)!, down, outcome, Date.now(), 'http://s');
		expect(received).toHaveLength(1);
	});
});
