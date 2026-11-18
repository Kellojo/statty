import { SvelteMap } from 'svelte/reactivity';
import type {
	Heartbeat,
	MonitorLiveState,
	MonitorSummary,
	PublicEvent,
	ServerEvent
} from '$lib/types.js';
import { LiveStream, refreshSoon } from './stream.svelte.js';

/** The dashboard's stream, shared by every page that shows monitors. */
export const dashboardStream = new LiveStream<ServerEvent>('/api/events');
/** The public status page's stream. */
export const publicStream = new LiveStream<PublicEvent>('/api/public/events');

/** Uptime and other aggregates come from the server; reload them at most this often while checks stream in. */
const AGGREGATE_REFRESH_MS = 30_000;

interface Patch {
	state: MonitorLiveState;
	/** Checks that arrived since the page's data was loaded. */
	beats: Heartbeat[];
}

/**
 * Monitors with live check results laid over the page's loaded data. Events
 * patch the monitors in place; config changes and status changes reload the
 * page's data, and the patches step aside once the loaded data is newer.
 */
export class LiveMonitors {
	#patches = new SvelteMap<string, Patch>();
	#lastAggregateRefresh = Date.now();

	/** Applies a dashboard event; call from `dashboardStream.listen`. */
	apply = (event: ServerEvent) => {
		if (event.type !== 'monitor.checked') {
			refreshSoon();
			return;
		}
		const patch = this.#patches.get(event.monitorId);
		const beats = [...(patch?.beats ?? []), event.heartbeat].slice(-200);
		this.#patches.set(event.monitorId, { state: event.state, beats });
		// A status change moves uptime figures and counts; otherwise refresh them now and then.
		const now = Date.now();
		if (event.state.lastChangeAt === event.heartbeat.checkedAt) {
			refreshSoon(1_000);
			this.#lastAggregateRefresh = now;
		} else if (now - this.#lastAggregateRefresh > AGGREGATE_REFRESH_MS) {
			this.#lastAggregateRefresh = now;
			refreshSoon(0);
		}
	};

	/** The monitor with live results applied; `limit` caps its recent checks. */
	merge<T extends MonitorSummary>(monitor: T, limit = 60): T {
		const patch = this.#patches.get(monitor.id);
		if (!patch || monitor.status === 'paused') return monitor;
		const loadedUntil = monitor.lastCheckedAt ?? 0;
		const newer = patch.beats.filter((b) => b.checkedAt > loadedUntil);
		if (newer.length === 0) return monitor;
		return {
			...monitor,
			...patch.state,
			recent: [...monitor.recent, ...newer].slice(-limit)
		};
	}

	/** The newest check results for one monitor that the loaded data doesn't have yet. */
	newBeats(monitorId: string, loadedUntil: number | null): Heartbeat[] {
		return (this.#patches.get(monitorId)?.beats ?? []).filter(
			(b) => b.checkedAt > (loadedUntil ?? 0)
		);
	}
}
