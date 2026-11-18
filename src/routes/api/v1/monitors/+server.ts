import { json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { listMonitorSummaries } from '$lib/server/db/repo/monitors.js';
import { asBadRequest, readBody } from '$lib/server/http.js';
import { monitorCreateSchema } from '$lib/server/monitor/input.js';
import { addMonitor } from '$lib/server/monitor/service.js';
import type { RequestHandler } from './$types';

/** All monitors with status, uptime and their latest checks (`?recent=` checks each, default 30). */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'status:read');
	const recent = Math.min(
		Math.max(Number(event.url.searchParams.get('recent') ?? 30) || 0, 0),
		200
	);
	return json({ monitors: listMonitorSummaries(getDb(), recent) });
};

export const POST: RequestHandler = async (event) => {
	const identity = await requireScope(event, 'monitors:write');
	const input = await readBody(event.request, monitorCreateSchema);
	const monitor = await asBadRequest(() => addMonitor(input, identity.userId));
	return json({ monitor }, { status: 201 });
};
