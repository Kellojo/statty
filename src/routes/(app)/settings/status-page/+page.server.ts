import { requireAdmin } from '$lib/server/auth/guards.js';
import { appOrigin } from '$lib/server/config.js';
import { getDb } from '$lib/server/db/index.js';
import { listMonitors } from '$lib/server/db/repo/monitors.js';
import { getStatusPageSettings } from '$lib/server/db/repo/settings.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	requireAdmin(locals);
	const db = getDb();
	return {
		settings: getStatusPageSettings(db),
		monitors: listMonitors(db).map((m) => ({
			id: m.id,
			name: m.name,
			type: m.type,
			status: m.status,
			public: m.public,
			faviconUrl: m.faviconUrl
		})),
		origin: appOrigin(url.origin)
	};
};
