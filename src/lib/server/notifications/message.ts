// When a check should notify, and what the message says. Pure functions, shared by
// every channel type; drivers only turn a NotificationMessage into their own request.

import { monitorTarget } from '$lib/monitor-format.js';
import type { Heartbeat, Monitor, MonitorStatus } from '$lib/types.js';

export type NotifyEvent = 'down' | 'up';

/** A channel-neutral message. */
export interface NotificationMessage {
	title: string;
	/** Markdown. */
	body: string;
	/** Opened when the notification is clicked. */
	url: string | null;
}

/**
 * Whether a check that moved a monitor from `previous` to `status` should notify:
 * 'down' when it turns down from up, pending or unknown (never checked, or just
 * resumed or edited), 'up' when it recovers from down. Pending checks never notify,
 * and neither does a monitor's first up check.
 *
 * A pending spell (failures with retries left, a container starting) sits between
 * two settled states, so after one the check is judged against `settledBefore`, the
 * monitor's last up or down check: down → pending → up is a recovery, and
 * down → pending → down is not a new outage.
 */
export function notifyEvent(
	previous: MonitorStatus,
	status: Heartbeat['status'],
	settledBefore: 'up' | 'down' | null = null
): NotifyEvent | null {
	if (status === 'pending' || previous === 'paused') return null;
	const from = previous === 'pending' ? (settledBefore ?? 'unknown') : previous;
	if (status === 'down') return from === 'down' ? null : 'down';
	return from === 'down' ? 'up' : null;
}

/** "45s", "12m", "3h 5m", "2d 4h". */
export function formatDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
	const d = Math.floor(h / 24);
	return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Check messages are plain text (error strings, "HTTP 503 …"); keep markdown from reading into them. */
function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_[\]<>#|~])/g, '\\$1');
}

function code(text: string): string {
	return `\`${text.replace(/`/g, "'")}\``;
}

export function monitorUrl(origin: string, monitorId: string): string {
	return `${origin.replace(/\/+$/, '')}/monitors/${encodeURIComponent(monitorId)}`;
}

export function monitorMessage(input: {
	monitor: Pick<Monitor, 'id' | 'name' | 'type' | 'url' | 'method' | 'container'>;
	event: NotifyEvent;
	/** The check's message, e.g. "HTTP 503 Service Unavailable". */
	message: string | null;
	latencyMs: number | null;
	/** When the outage began, for recoveries. */
	downSince: number | null;
	at: number;
	origin: string;
}): NotificationMessage {
	const { monitor, event } = input;
	const lines: string[] = [];
	if (event === 'down') {
		lines.push(escapeMarkdown(input.message ?? 'The check failed.'));
	} else {
		if (input.downSince !== null) {
			lines.push(`Down for **${formatDuration(input.at - input.downSince)}**.`);
		}
		const check = [
			input.message && escapeMarkdown(input.message),
			input.latencyMs !== null && `${input.latencyMs} ms`
		].filter(Boolean);
		if (check.length) lines.push(check.join(' · '));
	}
	lines.push(`**Target:** ${code(monitorTarget(monitor))}`);
	return {
		title: event === 'down' ? `🔴 ${monitor.name} is down` : `🟢 ${monitor.name} is up again`,
		body: lines.join('\n\n'),
		url: monitorUrl(input.origin, monitor.id)
	};
}

export function testMessage(channelName: string, origin: string): NotificationMessage {
	return {
		title: '🔔 Test from Statty',
		body: `Notifications from the **${escapeMarkdown(channelName)}** channel arrive here. Statty sends one when a monitor goes down and when it is up again.`,
		url: `${origin.replace(/\/+$/, '')}/settings/notifications`
	};
}
