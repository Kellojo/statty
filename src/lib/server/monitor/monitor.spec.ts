import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import {
	createMonitor,
	findMonitor,
	listPublicMonitors,
	MonitorInputError,
	recordCheck,
	statusChanges,
	updateMonitor,
	uptimes
} from '../db/repo/monitors.js';
import { overallStatus } from '$lib/status.js';
import { judgeContainer, parseDockerHost } from './docker-check.js';
import { isAcceptedStatus, monitorCreateSchema } from './input.js';

const fresh = () => openDatabase(':memory:');

describe('accepted statuses', () => {
	it('matches codes and ranges', () => {
		expect(isAcceptedStatus(204, '200-299')).toBe(true);
		expect(isAcceptedStatus(301, '200-299, 301')).toBe(true);
		expect(isAcceptedStatus(404, '200-299,301')).toBe(false);
	});

	it('rejects malformed lists', () => {
		const parsed = monitorCreateSchema.safeParse({
			name: 'x',
			type: 'http',
			url: 'https://a',
			acceptedStatuses: '2xx'
		});
		expect(parsed.success).toBe(false);
	});
});

describe('docker', () => {
	it('parses hosts', () => {
		expect(parseDockerHost('unix:///var/run/docker.sock')).toEqual({
			kind: 'socket',
			socketPath: '/var/run/docker.sock'
		});
		expect(parseDockerHost('npipe:////./pipe/docker_engine')).toEqual({
			kind: 'socket',
			socketPath: '\\\\.\\pipe\\docker_engine'
		});
		expect(parseDockerHost('tcp://10.0.0.2:2375')).toEqual({
			kind: 'tcp',
			baseUrl: 'http://10.0.0.2:2375',
			tls: false
		});
	});

	it('judges container states', () => {
		expect(judgeContainer({ State: { Running: true, Status: 'running' } }).status).toBe('up');
		expect(
			judgeContainer({ State: { Running: true, Health: { Status: 'starting' } } }).status
		).toBe('pending');
		expect(
			judgeContainer({ State: { Running: true, Health: { Status: 'unhealthy' } } }).status
		).toBe('down');
		expect(judgeContainer({ State: { Running: false, Status: 'exited', ExitCode: 1 } })).toEqual({
			status: 'down',
			message: 'Exited (exit code 1)'
		});
	});
});

describe('monitors repo', () => {
	it('needs a target for the type', () => {
		const db = fresh();
		expect(() => createMonitor(db, { name: 'a', type: 'http' }, null)).toThrow(MonitorInputError);
		expect(() => createMonitor(db, { name: 'b', type: 'docker' }, null)).toThrow(MonitorInputError);
	});

	it('keeps names unique, ignoring case', () => {
		const db = fresh();
		createMonitor(db, { name: 'Web', type: 'http', url: 'https://a' }, null);
		expect(() => createMonitor(db, { name: 'web', type: 'http', url: 'https://b' }, null)).toThrow(
			/already exists/
		);
		expect(findMonitor(db, 'WEB')?.url).toBe('https://a');
	});

	it('rejects a timeout longer than the interval', () => {
		const db = fresh();
		const m = createMonitor(db, { name: 'a', type: 'http', url: 'https://a' }, null);
		expect(() => updateMonitor(db, m.id, { intervalSeconds: 10, timeoutSeconds: 30 })).toThrow(
			/timeout/
		);
	});

	it('goes down only after the retries run out', () => {
		const db = fresh();
		const m = createMonitor(db, { name: 'a', type: 'http', url: 'https://a', retries: 1 }, null);
		const down = { status: 'down' as const, latencyMs: null, message: 'boom' };
		expect(recordCheck(db, m.id, down, 1000)?.status).toBe('pending');
		expect(recordCheck(db, m.id, down, 2000)?.status).toBe('down');
		expect(recordCheck(db, m.id, { status: 'up', latencyMs: 5, message: null }, 3000)?.status).toBe(
			'up'
		);
		expect(statusChanges(db, m.id).map((c) => c.status)).toEqual(['up', 'down', 'pending']);
	});

	it('pauses and resets', () => {
		const db = fresh();
		const m = createMonitor(db, { name: 'a', type: 'http', url: 'https://a' }, null);
		recordCheck(db, m.id, { status: 'up', latencyMs: 5, message: null });
		expect(updateMonitor(db, m.id, { enabled: false })?.status).toBe('paused');
		// A paused monitor ignores a check that finishes late.
		expect(recordCheck(db, m.id, { status: 'down', latencyMs: null, message: 'x' })).toBe(
			undefined
		);
		const resumed = updateMonitor(db, m.id, { enabled: true });
		expect(resumed?.status).toBe('unknown');
		expect(resumed?.lastCheckedAt).toBe(null);
	});

	it('computes uptime and public daily buckets', () => {
		const db = fresh();
		const m = createMonitor(db, { name: 'a', type: 'http', url: 'https://a' }, null);
		const now = Date.now();
		recordCheck(db, m.id, { status: 'up', latencyMs: 1, message: null }, now - 3000);
		recordCheck(db, m.id, { status: 'up', latencyMs: 1, message: null }, now - 2000);
		recordCheck(db, m.id, { status: 'up', latencyMs: 1, message: null }, now - 1500);
		recordCheck(db, m.id, { status: 'down', latencyMs: null, message: 'x' }, now - 1000);
		expect(uptimes(db, [m.id], now).get(m.id)?.day).toBe(75);
		const [pub] = listPublicMonitors(db, 90, now);
		expect(pub.days).toHaveLength(90);
		expect(pub.days.at(-1)?.down).toBe(1);
		expect(pub).not.toHaveProperty('url');
	});
});

describe('overall status', () => {
	it('summarises', () => {
		expect(overallStatus([])).toBe('unknown');
		expect(overallStatus(['up', 'paused'])).toBe('operational');
		expect(overallStatus(['up', 'down'])).toBe('degraded');
		expect(overallStatus(['down', 'unknown'])).toBe('outage');
	});
});
