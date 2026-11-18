import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import {
	FAVICON_REFRESH_MS,
	FAVICON_RETRY_MS,
	faviconDue,
	faviconOrigin,
	getFavicon,
	markFaviconFailed,
	saveFavicon
} from '../db/repo/favicons.js';
import { createMonitor, getMonitor, listPublicMonitors } from '../db/repo/monitors.js';
import { findFavicon } from './fetch.js';
import {
	MAX_ICON_BYTES,
	parseIconLinks,
	rankIcons,
	sniffImageType,
	validateIcon
} from './icons.js';

const PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db40000000049454e44ae426082',
	'hex'
);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('icon links', () => {
	const page = 'https://example.com/app/';

	it('reads icon, shortcut icon and apple-touch-icon links, resolved', () => {
		const html = `<!doctype html><html><head>
			<link rel="stylesheet" href="/a.css">
			<link rel="shortcut icon" href="/favicon.ico">
			<LINK REL='icon' type="image/png" sizes="32x32" href="icons/32.png">
			<link rel="apple-touch-icon" href="https://cdn.example.com/touch.png?a=1&amp;b=2">
			<link rel="mask-icon" href="/mask.svg">
			<!-- <link rel="icon" href="/commented.png"> -->
			<link rel="icon" href="javascript:alert(1)">
		</head><body><link rel="icon" href="/body.png"></body></html>`;
		const links = parseIconLinks(html, page);
		expect(links.map((l) => l.href)).toEqual([
			'https://example.com/favicon.ico',
			'https://example.com/app/icons/32.png',
			'https://cdn.example.com/touch.png?a=1&b=2'
		]);
		expect(links[1]).toMatchObject({ kind: 'icon', type: 'image/png', size: 32 });
		expect(links[2].kind).toBe('apple-touch-icon');
	});

	it('honours <base href>', () => {
		const links = parseIconLinks(
			'<head><base href="https://static.example.com/v2/"><link rel="icon" href="f.svg"></head>',
			page
		);
		expect(links[0].href).toBe('https://static.example.com/v2/f.svg');
	});

	it('prefers SVG, then square PNGs of 32px or more, then the rest', () => {
		const html = `<head>
			<link rel="icon" href="/16.png" sizes="16x16" type="image/png">
			<link rel="icon" href="/favicon.ico">
			<link rel="apple-touch-icon" href="/touch.png">
			<link rel="icon" href="/wide.png" sizes="64x32">
			<link rel="icon" href="/32.png" sizes="32x32" type="image/png">
			<link rel="icon" href="/192.png" sizes="192x192">
			<link rel="icon" href="/logo.svg" type="image/svg+xml">
		</head>`;
		const ranked = rankIcons(parseIconLinks(html, page)).map((u) => new URL(u).pathname);
		expect(ranked).toEqual([
			'/logo.svg',
			'/32.png',
			'/192.png',
			'/touch.png',
			'/favicon.ico',
			'/16.png',
			'/wide.png'
		]);
	});

	it('handles pages without a head or icons', () => {
		expect(parseIconLinks('', page)).toEqual([]);
		expect(rankIcons(parseIconLinks('<p>hello</p>', page))).toEqual([]);
	});
});

describe('icon validation', () => {
	it('sniffs images by their bytes', () => {
		expect(sniffImageType(PNG)).toBe('image/png');
		expect(sniffImageType(ICO)).toBe('image/x-icon');
		expect(sniffImageType(SVG)).toBe('image/svg+xml');
		expect(sniffImageType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), SVG]))).toBe(
			'image/svg+xml'
		);
		expect(sniffImageType(Buffer.from('GIF89a...'))).toBe('image/gif');
		expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(sniffImageType(Buffer.from('<!doctype html><svg></svg>'))).toBeNull();
		expect(sniffImageType(Buffer.from('not an image'))).toBeNull();
	});

	it('serves the sniffed type, whatever the server declared', () => {
		expect(validateIcon('image/vnd.microsoft.icon', ICO)).toBe('image/x-icon');
		expect(validateIcon('application/octet-stream', PNG)).toBe('image/png');
		expect(validateIcon(null, SVG)).toBe('image/svg+xml');
		expect(validateIcon('image/png; charset=binary', PNG)).toBe('image/png');
	});

	it('refuses HTML, mislabelled bytes, empty and oversized bodies', () => {
		expect(validateIcon('text/html', PNG)).toBeNull();
		expect(validateIcon('image/png', Buffer.from('<html>404</html>'))).toBeNull();
		expect(validateIcon('image/png', Buffer.alloc(0))).toBeNull();
		const huge = Buffer.concat([PNG, Buffer.alloc(MAX_ICON_BYTES)]);
		expect(validateIcon('image/png', huge)).toBeNull();
	});
});

describe('icon cache', () => {
	it('keys by origin and only for http(s)', () => {
		expect(faviconOrigin('https://Example.com:443/a/b?c')).toBe('https://example.com');
		expect(faviconOrigin('http://localhost:8080/x')).toBe('http://localhost:8080');
		expect(faviconOrigin('ftp://x')).toBeNull();
		expect(faviconOrigin(null)).toBeNull();
	});

	it('refreshes found icons weekly and retries failures daily, keeping the old icon', () => {
		const db = openDatabase(':memory:');
		const o = 'https://a.example';
		const t = 1_000_000_000_000;
		expect(faviconDue(db, o, t)).toBe(true);
		expect(saveFavicon(db, o, { contentType: 'image/png', body: PNG }, t)).toBe(true);
		expect(saveFavicon(db, o, { contentType: 'image/png', body: PNG }, t)).toBe(false);
		expect(faviconDue(db, o, t + FAVICON_REFRESH_MS - 1)).toBe(false);
		expect(faviconDue(db, o, t + FAVICON_REFRESH_MS)).toBe(true);
		markFaviconFailed(db, o, t + FAVICON_REFRESH_MS);
		expect(getFavicon(db, o)?.contentType).toBe('image/png');
		expect(faviconDue(db, o, t + FAVICON_REFRESH_MS + FAVICON_RETRY_MS - 1)).toBe(false);
		expect(faviconDue(db, o, t + FAVICON_REFRESH_MS + FAVICON_RETRY_MS)).toBe(true);
	});

	it('sets faviconUrl on HTTP monitors of a cached origin only', () => {
		const db = openDatabase(':memory:');
		const web = createMonitor(db, { name: 'web', type: 'http', url: 'https://a.example/h' }, null);
		const dock = createMonitor(db, { name: 'db', type: 'docker', container: 'pg' }, null);
		expect(web.faviconUrl).toBeNull();
		saveFavicon(db, 'https://a.example', { contentType: 'image/png', body: PNG });
		expect(getMonitor(db, web.id)?.faviconUrl).toMatch(
			new RegExp(`^/api/monitors/${web.id}/favicon\\?v=[0-9a-f]{16}$`)
		);
		expect(getMonitor(db, dock.id)?.faviconUrl).toBeNull();
		expect(listPublicMonitors(db).find((m) => m.id === web.id)?.faviconUrl).toBeTruthy();
	});
});

describe('finding a site icon', () => {
	let server: Server;
	let origin = '';
	const routes: Record<string, { type: string; body: Buffer | string; status?: number }> = {
		'/': {
			type: 'text/html',
			body: '<html><head><link rel="icon" href="/broken.png" sizes="64x64" type="image/png"><link rel="icon" href="/fav.png" sizes="32x32" type="image/png"></head></html>'
		},
		// An HTML error page served as 200, as some sites do.
		'/broken.png': { type: 'text/html', body: '<html>not found</html>' },
		'/fav.png': { type: 'image/png', body: PNG },
		'/favicon.ico': { type: 'image/x-icon', body: ICO }
	};

	beforeAll(async () => {
		server = createServer((req, res) => {
			const route = routes[req.url ?? ''];
			if (!route) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(route.status ?? 200, { 'content-type': route.type }).end(route.body);
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterAll(() => new Promise<void>((r) => server.close(() => r())));

	it('takes the best declared icon that really is an image', async () => {
		const icon = await findFavicon(origin);
		expect(icon?.contentType).toBe('image/png');
		expect(icon?.body.equals(PNG)).toBe(true);
	});

	it('falls back to /favicon.ico', async () => {
		routes['/'] = { type: 'text/html', body: '<html><head><title>x</title></head></html>' };
		const icon = await findFavicon(origin);
		expect(icon?.contentType).toBe('image/x-icon');
	});

	it('gives up when nothing is an image', async () => {
		delete routes['/favicon.ico'];
		expect(await findFavicon(origin)).toBeNull();
	});
});
