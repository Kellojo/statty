// Runs due checks. A tick every few seconds picks the enabled monitors whose
// interval has passed; each monitor has at most one check in flight.

import type { Monitor } from '$lib/types.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import {
	dueMonitors,
	getMonitor,
	pruneHeartbeats,
	recordCheck,
	type CheckOutcome
} from '../db/repo/monitors.js';
import { publishCheck } from '../events.js';
import { sweepFavicons } from '../favicon/service.js';
import { createLogger } from '../logger.js';
import { notifyCheck } from '../notifications/index.js';
import { checkDocker } from './docker-check.js';
import { checkHttp } from './http-check.js';

const log = createLogger('monitor');

const TICK_MS = 2_000;
const MAX_CONCURRENT = 25;
const PRUNE_EVERY_MS = 60 * 60_000;
/** Looks for site icons that are missing or due a refresh (they are cached for days). */
const FAVICON_SWEEP_MS = 15 * 60_000;

const inFlight = new Map<string, Promise<CheckOutcome | undefined>>();

export function runCheck(monitor: Monitor): Promise<CheckOutcome> {
	return monitor.type === 'docker' ? checkDocker(monitor) : checkHttp(monitor);
}

/** Checks a monitor now and stores the result; joins a check already running. */
export function checkMonitor(id: string): Promise<CheckOutcome | undefined> {
	const running = inFlight.get(id);
	if (running) return running;
	const monitor = getMonitor(getDb(), id);
	if (!monitor || !monitor.enabled) return Promise.resolve(undefined);
	const task = (async () => {
		try {
			const outcome = await runCheck(monitor);
			const checkedAt = Date.now();
			const change = recordCheck(getDb(), id, outcome, checkedAt);
			const after = change && getMonitor(getDb(), id);
			if (change && after) {
				publishCheck(after, {
					status: change.status,
					latencyMs: outcome.latencyMs,
					message: outcome.message,
					checkedAt
				});
				// Not awaited: a slow notification channel must never hold up checks.
				void notifyCheck(getDb(), after, change, outcome, checkedAt);
			}
			if (change && change.previous !== change.status && change.previous !== 'unknown') {
				log.info(`${monitor.name} is ${change.status}`, {
					monitorId: id,
					from: change.previous,
					message: outcome.message
				});
			}
			return outcome;
		} catch (e) {
			log.error('Check failed', { monitorId: id, error: String(e) });
			return undefined;
		} finally {
			inFlight.delete(id);
		}
	})();
	inFlight.set(id, task);
	return task;
}

function tick() {
	let due: Monitor[];
	try {
		due = dueMonitors(getDb());
	} catch (e) {
		log.error('Could not load due monitors', { error: String(e) });
		return;
	}
	for (const monitor of due) {
		if (inFlight.size >= MAX_CONCURRENT) break;
		if (!inFlight.has(monitor.id)) void checkMonitor(monitor.id);
	}
}

function prune() {
	try {
		const removed = pruneHeartbeats(getDb(), config.HEARTBEAT_RETENTION_DAYS);
		if (removed > 0) log.info(`Pruned ${removed} old checks`);
	} catch (e) {
		log.error('Pruning checks failed', { error: String(e) });
	}
}

const state = globalThis as {
	__stattyScheduler?: { tick: NodeJS.Timeout; prune: NodeJS.Timeout; favicons: NodeJS.Timeout };
};

/** Starts the checks once per process (the dev server re-runs hooks on changes). */
export function startScheduler(): void {
	if (state.__stattyScheduler) return;
	prune();
	state.__stattyScheduler = {
		tick: setInterval(tick, TICK_MS),
		prune: setInterval(prune, PRUNE_EVERY_MS),
		favicons: setInterval(sweepFavicons, FAVICON_SWEEP_MS)
	};
	state.__stattyScheduler.tick.unref();
	state.__stattyScheduler.prune.unref();
	state.__stattyScheduler.favicons.unref();
	setTimeout(tick, 500).unref();
	// After the first checks, so startup isn't busy fetching icons.
	setTimeout(sweepFavicons, 10_000).unref();
	log.info('Monitor scheduler started');
}

export function stopScheduler(): void {
	if (!state.__stattyScheduler) return;
	clearInterval(state.__stattyScheduler.tick);
	clearInterval(state.__stattyScheduler.prune);
	clearInterval(state.__stattyScheduler.favicons);
	state.__stattyScheduler = undefined;
}
