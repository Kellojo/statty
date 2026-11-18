// Site icons, cached per origin. See migrations/0003_favicons.sql.

import { createHash } from 'node:crypto';
import type { Db } from '../index.js';

const DAY_MS = 24 * 60 * 60_000;
/** Found icons are looked for again after this long, in case the site changed its icon. */
export const FAVICON_REFRESH_MS = 7 * DAY_MS;
/** Origins without a usable icon (or that were down) are retried after this long. */
export const FAVICON_RETRY_MS = DAY_MS;

export interface StoredFavicon {
	contentType: string;
	body: Buffer;
	hash: string;
	fetchedAt: number;
}

interface FaviconRow {
	origin: string;
	content_type: string | null;
	body: Buffer | null;
	hash: string | null;
	fetched_at: number;
	failed: number;
}

/** The origin a URL's icon is cached under, or null for anything but http(s). */
export function faviconOrigin(url: string | null | undefined): string | null {
	if (!url || !URL.canParse(url)) return null;
	const u = new URL(url);
	return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
}

export function getFavicon(db: Db, origin: string): StoredFavicon | null {
	const row = db
		.prepare('SELECT * FROM favicons WHERE origin = ? AND body IS NOT NULL')
		.get(origin) as FaviconRow | undefined;
	if (!row?.body || !row.content_type || !row.hash) return null;
	return {
		contentType: row.content_type,
		body: row.body,
		hash: row.hash,
		fetchedAt: row.fetched_at
	};
}

/** The stored icon's hash for `origin` (cheap: no body), or null. */
export function faviconHash(db: Db, origin: string): string | null {
	const row = db
		.prepare('SELECT hash FROM favicons WHERE origin = ? AND body IS NOT NULL')
		.get(origin) as { hash: string | null } | undefined;
	return row?.hash ?? null;
}

/** Whether `origin` has never been searched, or its last search is old enough to repeat. */
export function faviconDue(db: Db, origin: string, now = Date.now()): boolean {
	const row = db.prepare('SELECT fetched_at, failed FROM favicons WHERE origin = ?').get(origin) as
		Pick<FaviconRow, 'fetched_at' | 'failed'> | undefined;
	if (!row) return true;
	return now - row.fetched_at >= (row.failed ? FAVICON_RETRY_MS : FAVICON_REFRESH_MS);
}

/** Stores a found icon; returns whether it differs from the one stored before. */
export function saveFavicon(
	db: Db,
	origin: string,
	icon: { contentType: string; body: Buffer },
	now = Date.now()
): boolean {
	const hash = createHash('sha256').update(icon.body).digest('hex');
	const before = faviconHash(db, origin);
	db.prepare(
		`INSERT INTO favicons (origin, content_type, body, hash, fetched_at, failed)
		 VALUES (?, ?, ?, ?, ?, 0)
		 ON CONFLICT (origin) DO UPDATE SET content_type = excluded.content_type,
		   body = excluded.body, hash = excluded.hash, fetched_at = excluded.fetched_at, failed = 0`
	).run(origin, icon.contentType, icon.body, hash, now);
	return before !== hash;
}

/** Records a search that found nothing. An icon found earlier stays until a search replaces it. */
export function markFaviconFailed(db: Db, origin: string, now = Date.now()): void {
	db.prepare(
		`INSERT INTO favicons (origin, fetched_at, failed) VALUES (?, ?, 1)
		 ON CONFLICT (origin) DO UPDATE SET fetched_at = excluded.fetched_at, failed = 1`
	).run(origin, now);
}

/** The URL a monitor's icon is served at, versioned by its hash so browsers can cache it long. */
export function faviconPath(monitorId: string, hash: string): string {
	return `/api/monitors/${monitorId}/favicon?v=${hash.slice(0, 16)}`;
}
