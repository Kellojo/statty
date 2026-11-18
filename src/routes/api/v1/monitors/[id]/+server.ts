import { error, json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { findMonitor, getMonitorSummary, statusChanges } from '$lib/server/db/repo/monitors.js';
import { asBadRequest, readBody } from '$lib/server/http.js';
import { monitorUpdateSchema } from '$lib/server/monitor/input.js';
import { editMonitor, removeMonitor } from '$lib/server/monitor/service.js';
import type { RequestHandler } from './$types';

/** `:id` is a monitor id, or its exact name. */
function monitorOr404(ref: string) {
	const monitor = findMonitor(getDb(), ref);
	if (!monitor) error(404, { message: 'Monitor not found' });
	return monitor;
}

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'status:read');
	const monitor = monitorOr404(event.params.id);
	const db = getDb();
	return json({
		monitor: getMonitorSummary(db, monitor.id, 100),
		statusChanges: statusChanges(db, monitor.id, 20)
	});
};

export const PATCH: RequestHandler = async (event) => {
	await requireScope(event, 'monitors:write');
	const monitor = monitorOr404(event.params.id);
	const input = await readBody(event.request, monitorUpdateSchema);
	const updated = await asBadRequest(() => editMonitor(monitor.id, input));
	if (!updated) error(404, { message: 'Monitor not found' });
	return json({ monitor: updated });
};

export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'monitors:write');
	const monitor = monitorOr404(event.params.id);
	removeMonitor(monitor.id);
	return json({ ok: true });
};
