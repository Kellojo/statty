import { getDb } from '$lib/server/db/index.js';
import { listMonitorSummaries } from '$lib/server/db/repo/monitors.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	monitors: listMonitorSummaries(getDb(), 40)
});
