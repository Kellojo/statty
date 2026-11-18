import { requireScope } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { faviconOrigin, getFavicon } from '$lib/server/db/repo/favicons.js';
import { getMonitor } from '$lib/server/db/repo/monitors.js';
import type { RequestHandler } from './$types';

/** The bytes are the site's, not ours: no scripts or sub-resources even if opened directly. */
const SECURITY_HEADERS = {
	'x-content-type-options': 'nosniff',
	'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
};

function notFound(): Response {
	return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}

/**
 * A monitor's cached site icon. Only monitors' own origins are ever served,
 * never an arbitrary URL. Public monitors' icons are anonymous (the status
 * page shows them); the rest need a session or a status:read key. Unknown ids
 * get the same answer as private ones, so ids can't be probed.
 */
export const GET: RequestHandler = async (event) => {
	const monitor = getMonitor(getDb(), event.params.id);
	if (!monitor?.public) await requireScope(event, 'status:read');
	if (!monitor || monitor.type !== 'http') return notFound();
	const origin = faviconOrigin(monitor.url);
	const icon = origin ? getFavicon(getDb(), origin) : null;
	if (!icon) return notFound();

	const etag = `"${icon.hash.slice(0, 32)}"`;
	const headers = {
		...SECURITY_HEADERS,
		etag,
		// URLs carry the icon's hash (?v=), so a day's caching is safe; revalidating is cheap.
		'cache-control': `${monitor.public ? 'public' : 'private'}, max-age=86400, stale-while-revalidate=604800`
	};
	if (
		event.request.headers
			.get('if-none-match')
			?.split(/\s*,\s*/)
			.includes(etag)
	) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(new Uint8Array(icon.body), {
		headers: {
			...headers,
			'content-type': icon.contentType,
			'content-length': String(icon.body.length)
		}
	});
};
