import { requireAdmin } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import { listMonitors } from '$lib/server/db/repo/monitors.js';
import { listNotificationChannels } from '$lib/server/notifications/index.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const db = getDb();
	return {
		channels: listNotificationChannels(db),
		monitors: listMonitors(db).map((m) => ({ id: m.id, name: m.name, status: m.status }))
	};
};
