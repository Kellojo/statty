// Keeps HTTP monitors' site icons cached, always in the background: nothing
// here is awaited by a check or an API response. A new or changed icon
// publishes `monitor.changed`, so open pages reload and show it.

import type { Monitor } from '$lib/types.js';
import { getDb } from '../db/index.js';
import { faviconDue, faviconOrigin, markFaviconFailed, saveFavicon } from '../db/repo/favicons.js';
import { listMonitors } from '../db/repo/monitors.js';
import { publishChange } from '../events.js';
import { createLogger } from '../logger.js';
import { findFavicon } from './fetch.js';

const log = createLogger('favicon');

/** Searches running at once; icons are a nicety and shouldn't crowd out checks. */
const MAX_CONCURRENT = 2;

/** Origins queued or being searched, so each is searched once at a time. */
const queued = new Map<string, { ignoreTls: boolean }>();
const running = new Set<string>();

function http(monitors: Monitor[], origin: string) {
	return monitors.filter((m) => m.type === 'http' && faviconOrigin(m.url) === origin);
}

async function search(origin: string, ignoreTls: boolean): Promise<void> {
	const icon = await findFavicon(origin, { ignoreTls });
	const db = getDb();
	if (!icon) {
		markFaviconFailed(db, origin);
		return;
	}
	if (saveFavicon(db, origin, icon)) {
		log.info('Stored site icon', { origin, type: icon.contentType, bytes: icon.body.length });
		for (const m of http(listMonitors(db), origin)) publishChange(m.id);
	}
}

function pump() {
	for (const [origin, opts] of queued) {
		if (running.size >= MAX_CONCURRENT) return;
		if (running.has(origin)) continue;
		queued.delete(origin);
		running.add(origin);
		search(origin, opts.ignoreTls)
			.catch((e) => log.warn('Icon search failed', { origin, error: String(e) }))
			.finally(() => {
				running.delete(origin);
				pump();
			});
	}
}

function enqueue(origin: string, ignoreTls: boolean) {
	if (running.has(origin)) return;
	const existing = queued.get(origin);
	queued.set(origin, { ignoreTls: ignoreTls || Boolean(existing?.ignoreTls) });
	pump();
}

/**
 * Looks for a monitor's icon in the background if its origin has none yet
 * (or is due a refresh). Call after a monitor is created or its URL changes.
 */
export function ensureFavicon(monitor: Monitor): void {
	if (monitor.type !== 'http') return;
	const origin = faviconOrigin(monitor.url);
	try {
		if (origin && faviconDue(getDb(), origin)) enqueue(origin, monitor.ignoreTls);
	} catch (e) {
		log.warn('Could not queue icon search', { origin, error: String(e) });
	}
}

/**
 * Queues every origin that has never been searched, or whose icon is due a
 * refresh (weekly) or retry (daily). The scheduler runs this now and then.
 */
export function sweepFavicons(): void {
	try {
		const db = getDb();
		const origins = new Map<string, boolean>();
		for (const m of listMonitors(db)) {
			const origin = m.type === 'http' ? faviconOrigin(m.url) : null;
			// A monitor that ignores TLS errors vouches for its origin's certificate.
			if (origin) origins.set(origin, (origins.get(origin) ?? false) || m.ignoreTls);
		}
		for (const [origin, ignoreTls] of origins) {
			if (faviconDue(db, origin)) enqueue(origin, ignoreTls);
		}
	} catch (e) {
		log.error('Icon sweep failed', { error: String(e) });
	}
}
