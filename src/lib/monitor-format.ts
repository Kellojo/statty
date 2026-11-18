import type { Monitor, MonitorStatus } from './types.js';

export const STATUS_LABEL: Record<MonitorStatus, string> = {
	up: 'Up',
	down: 'Down',
	pending: 'Pending',
	unknown: 'Not checked',
	paused: 'Paused'
};

/** Background colour classes per status (dots, bars). */
export const STATUS_BG: Record<MonitorStatus, string> = {
	up: 'bg-success',
	down: 'bg-destructive',
	pending: 'bg-warning',
	unknown: 'bg-muted-foreground/40',
	paused: 'bg-muted-foreground/40'
};

export const STATUS_TEXT: Record<MonitorStatus, string> = {
	up: 'text-success-foreground',
	down: 'text-destructive',
	pending: 'text-warning-foreground',
	unknown: 'text-muted-foreground',
	paused: 'text-muted-foreground'
};

export function formatUptime(value: number | null): string {
	if (value === null) return '–';
	return `${value >= 99.995 ? '100' : value.toFixed(2)}%`;
}

export function formatLatency(ms: number | null): string {
	if (ms === null) return '–';
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

/** What a monitor checks, in one line. */
export function monitorTarget(m: Pick<Monitor, 'type' | 'url' | 'method' | 'container'>): string {
	if (m.type === 'docker') return `Container ${m.container ?? ''}`;
	return m.method === 'GET' ? (m.url ?? '') : `${m.method} ${m.url ?? ''}`;
}

export function formatInterval(seconds: number): string {
	if (seconds % 3600 === 0) return `${seconds / 3600}h`;
	if (seconds % 60 === 0) return `${seconds / 60}m`;
	return `${seconds}s`;
}

export function formatDateTime(ts: number): string {
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

export function formatTimeAgo(ts: number, now = Date.now()): string {
	const s = Math.max(0, Math.floor((now - ts) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return d < 30 ? `${d}d ago` : formatDateTime(ts);
}

/** "3d 4h", "12m": how long a status has held. */
export function formatDuration(ms: number): string {
	const m = Math.floor(ms / 60_000);
	if (m < 1) return 'under a minute';
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ${m % 60}m`;
	return `${Math.floor(h / 24)}d ${h % 24}h`;
}
