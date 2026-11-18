import { getDb } from '$lib/server/db/index.js';
import { listPublicMonitors } from '$lib/server/db/repo/monitors.js';
import { getStatusPageSettings } from '$lib/server/db/repo/settings.js';
import { overallStatus } from '$lib/status.js';
import type { PageServerLoad } from './$types';

// The public status page: no sign-in needed.
export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const monitors = listPublicMonitors(db, 90);
	return {
		page: getStatusPageSettings(db),
		status: overallStatus(monitors.map((m) => m.status)),
		monitors,
		signedIn: Boolean(locals.user),
		generatedAt: Date.now()
	};
};
