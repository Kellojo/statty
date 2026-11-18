import { json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { listMonitors } from '$lib/server/db/repo/monitors.js';
import { countStatuses, overallStatus } from '$lib/status.js';
import type { RequestHandler } from './$types';

/** One-glance status of every monitor (public and private). */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'status:read');
	const monitors = listMonitors(getDb());
	const statuses = monitors.map((m) => m.status);
	return json({
		status: overallStatus(statuses),
		counts: countStatuses(statuses),
		down: monitors
			.filter((m) => m.status === 'down')
			.map((m) => ({ id: m.id, name: m.name, message: m.message, since: m.lastChangeAt }))
	});
};
