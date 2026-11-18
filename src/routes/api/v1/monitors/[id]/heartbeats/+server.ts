import { error, json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { findMonitor, heartbeatsSince } from '$lib/server/db/repo/monitors.js';
import type { RequestHandler } from './$types';

/** A monitor's checks over the last `?hours=` hours (default 24, max 720), oldest first. */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'status:read');
	const monitor = findMonitor(getDb(), event.params.id);
	if (!monitor) error(404, { message: 'Monitor not found' });
	const hours = Math.min(Math.max(Number(event.url.searchParams.get('hours') ?? 24) || 24, 1), 720);
	return json({
		monitorId: monitor.id,
		heartbeats: heartbeatsSince(getDb(), monitor.id, Date.now() - hours * 3_600_000, 50_000)
	});
};
