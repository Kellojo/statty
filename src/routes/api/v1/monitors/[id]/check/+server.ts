import { error, json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { findMonitor } from '$lib/server/db/repo/monitors.js';
import { checkNow } from '$lib/server/monitor/service.js';
import type { RequestHandler } from './$types';

/** Runs a check now. */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'monitors:write');
	const monitor = findMonitor(getDb(), event.params.id);
	if (!monitor) error(404, { message: 'Monitor not found' });
	if (!monitor.enabled) error(409, { message: 'The monitor is paused' });
	const result = await checkNow(monitor.id);
	if (!result) error(409, { message: 'The monitor is paused' });
	return json({ monitor: result });
};
