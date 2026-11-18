import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { getMonitorSummary, heartbeatsSince, statusChanges } from '$lib/server/db/repo/monitors.js';
import type { PageServerLoad } from './$types';

const RANGES = { '1h': 1, '24h': 24, '7d': 168 } as const;
type Range = keyof typeof RANGES;

export const load: PageServerLoad = ({ params, url }) => {
	const db = getDb();
	const monitor = getMonitorSummary(db, params.id, 60);
	if (!monitor) error(404, { message: 'Monitor not found' });
	const asked = url.searchParams.get('range');
	const range: Range = asked && asked in RANGES ? (asked as Range) : '24h';
	const now = Date.now();
	return {
		monitor,
		range,
		history: heartbeatsSince(db, monitor.id, now - RANGES[range] * 3_600_000, 20_000),
		changes: statusChanges(db, monitor.id, 25)
	};
};
