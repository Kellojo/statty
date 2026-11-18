import type { MonitorStatus } from './types.js';

export type OverallStatus = 'operational' | 'degraded' | 'outage' | 'unknown';

/** One word for a set of monitors: all up, some down, all down, or nothing checked yet. */
export function overallStatus(statuses: MonitorStatus[]): OverallStatus {
	const active = statuses.filter((s) => s !== 'paused' && s !== 'unknown');
	if (active.length === 0) return 'unknown';
	const down = active.filter((s) => s === 'down').length;
	if (down === 0) return active.some((s) => s === 'pending') ? 'degraded' : 'operational';
	return down === active.length ? 'outage' : 'degraded';
}

export function countStatuses(statuses: MonitorStatus[]): Record<MonitorStatus, number> {
	const counts: Record<MonitorStatus, number> = {
		up: 0,
		down: 0,
		pending: 0,
		unknown: 0,
		paused: 0
	};
	for (const s of statuses) counts[s]++;
	return counts;
}
