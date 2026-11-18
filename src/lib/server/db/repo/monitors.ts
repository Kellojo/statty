import { randomUUID } from 'node:crypto';
import type {
	Heartbeat,
	HttpMethod,
	Monitor,
	MonitorStatus,
	MonitorSummary,
	MonitorType,
	PublicMonitor,
	Uptime
} from '$lib/types.js';
import type { Db } from '../index.js';
import {
	DEFAULTS,
	fieldsProblem,
	type MonitorCreateInput,
	type MonitorFields,
	type MonitorUpdateInput
} from '../../monitor/input.js';
import { faviconHash, faviconOrigin, faviconPath } from './favicons.js';

interface MonitorRow {
	id: string;
	name: string;
	description: string | null;
	type: MonitorType;
	url: string | null;
	method: HttpMethod;
	accepted_statuses: string;
	keyword: string | null;
	ignore_tls: number;
	container: string | null;
	docker_host: string | null;
	interval_seconds: number;
	timeout_seconds: number;
	retries: number;
	enabled: number;
	public: number;
	sort_order: number;
	status: MonitorStatus;
	message: string | null;
	latency_ms: number | null;
	failures: number;
	last_checked_at: number | null;
	last_change_at: number | null;
	created_by: string | null;
	created_at: number;
	updated_at: number;
}

interface HeartbeatRow {
	monitor_id: string;
	status: Heartbeat['status'];
	latency_ms: number | null;
	message: string | null;
	checked_at: number;
}

const DAY_MS = 24 * 60 * 60_000;

export class MonitorInputError extends Error {}

/** Refuses a name another monitor already has (names are unique, ignoring case). */
function assertNameFree(db: Db, name: string, exceptId: string | null): void {
	const clash = db
		.prepare('SELECT id FROM monitors WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
		.get(name, exceptId);
	if (clash) throw new MonitorInputError(`name: A monitor named "${name}" already exists`);
}

/** The served icon of an HTTP monitor whose origin has one cached; null otherwise. */
function faviconUrl(db: Db, row: MonitorRow): string | null {
	if (row.type !== 'http') return null;
	const origin = faviconOrigin(row.url);
	const hash = origin && faviconHash(db, origin);
	return hash ? faviconPath(row.id, hash) : null;
}

function toMonitor(db: Db, row: MonitorRow): Monitor {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		type: row.type,
		url: row.url,
		method: row.method,
		acceptedStatuses: row.accepted_statuses,
		keyword: row.keyword,
		ignoreTls: row.ignore_tls === 1,
		container: row.container,
		dockerHost: row.docker_host,
		intervalSeconds: row.interval_seconds,
		timeoutSeconds: row.timeout_seconds,
		retries: row.retries,
		enabled: row.enabled === 1,
		public: row.public === 1,
		sortOrder: row.sort_order,
		status: row.enabled === 1 ? row.status : 'paused',
		message: row.message,
		latencyMs: row.latency_ms,
		lastCheckedAt: row.last_checked_at,
		lastChangeAt: row.last_change_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		faviconUrl: faviconUrl(db, row)
	};
}

function toHeartbeat(row: HeartbeatRow): Heartbeat {
	return {
		status: row.status,
		latencyMs: row.latency_ms,
		message: row.message,
		checkedAt: row.checked_at
	};
}

const ORDER = 'ORDER BY sort_order, name COLLATE NOCASE';

export function listMonitors(db: Db, opts: { publicOnly?: boolean } = {}): Monitor[] {
	const where = opts.publicOnly ? 'WHERE public = 1' : '';
	return (db.prepare(`SELECT * FROM monitors ${where} ${ORDER}`).all() as MonitorRow[]).map((r) =>
		toMonitor(db, r)
	);
}

export function getMonitor(db: Db, id: string): Monitor | undefined {
	const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as MonitorRow | undefined;
	return row ? toMonitor(db, row) : undefined;
}

/** Finds a monitor by id, or else by its exact name (case-insensitive), for API and MCP callers. */
export function findMonitor(db: Db, idOrName: string): Monitor | undefined {
	const byId = getMonitor(db, idOrName);
	if (byId) return byId;
	const row = db.prepare('SELECT * FROM monitors WHERE name = ? COLLATE NOCASE').get(idOrName) as
		MonitorRow | undefined;
	return row ? toMonitor(db, row) : undefined;
}

function columns(f: MonitorFields) {
	return {
		name: f.name,
		description: f.description,
		type: f.type,
		url: f.type === 'http' ? f.url : null,
		method: f.method,
		accepted_statuses: f.acceptedStatuses,
		keyword: f.keyword,
		ignore_tls: f.ignoreTls ? 1 : 0,
		container: f.type === 'docker' ? f.container : null,
		docker_host: f.type === 'docker' ? f.dockerHost : null,
		interval_seconds: f.intervalSeconds,
		timeout_seconds: f.timeoutSeconds,
		retries: f.retries,
		enabled: f.enabled ? 1 : 0,
		public: f.public ? 1 : 0,
		sort_order: f.sortOrder
	};
}

export function createMonitor(db: Db, input: MonitorCreateInput, userId: string | null): Monitor {
	const fields: MonitorFields = { ...DEFAULTS, ...stripUndefined(input) } as MonitorFields;
	const problem = fieldsProblem(fields);
	if (problem) throw new MonitorInputError(problem);
	assertNameFree(db, fields.name, null);
	const id = randomUUID();
	const now = Date.now();
	const cols = {
		id,
		...columns(fields),
		status: 'unknown',
		created_by: userId,
		created_at: now,
		updated_at: now
	};
	const names = Object.keys(cols);
	db.prepare(
		`INSERT INTO monitors (${names.join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`
	).run(cols);
	return getMonitor(db, id)!;
}

function stripUndefined<T extends object>(input: T): Partial<T> {
	return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function fieldsOf(m: Monitor): MonitorFields {
	return {
		name: m.name,
		description: m.description,
		type: m.type,
		url: m.url,
		method: m.method,
		acceptedStatuses: m.acceptedStatuses,
		keyword: m.keyword,
		ignoreTls: m.ignoreTls,
		container: m.container,
		dockerHost: m.dockerHost,
		intervalSeconds: m.intervalSeconds,
		timeoutSeconds: m.timeoutSeconds,
		retries: m.retries,
		enabled: m.enabled,
		public: m.public,
		sortOrder: m.sortOrder
	};
}

/**
 * Applies a partial update. Changing what is checked (type, target, method,
 * expectations) or turning the monitor back on clears its state, so the next
 * check starts fresh; turning it off pauses it.
 */
export function updateMonitor(db: Db, id: string, input: MonitorUpdateInput): Monitor | undefined {
	const current = getMonitor(db, id);
	if (!current) return undefined;
	const before = fieldsOf(current);
	const next: MonitorFields = { ...before, ...stripUndefined(input) } as MonitorFields;
	const problem = fieldsProblem(next);
	if (problem) throw new MonitorInputError(problem);
	assertNameFree(db, next.name, id);

	const checkChanged = (
		[
			'type',
			'url',
			'method',
			'acceptedStatuses',
			'keyword',
			'ignoreTls',
			'container',
			'dockerHost'
		] as const
	).some((k) => before[k] !== next[k]);
	const resumed = !before.enabled && next.enabled;
	const reset = checkChanged || resumed;

	const cols = { ...columns(next), id, updated_at: Date.now() };
	const sets = Object.keys(cols)
		.filter((k) => k !== 'id')
		.map((k) => `${k} = @${k}`);
	db.transaction(() => {
		db.prepare(`UPDATE monitors SET ${sets.join(', ')} WHERE id = @id`).run(cols);
		if (reset) {
			db.prepare(
				`UPDATE monitors SET status = 'unknown', failures = 0, message = NULL, last_checked_at = NULL
				 WHERE id = ?`
			).run(id);
		}
	})();
	return getMonitor(db, id);
}

export function deleteMonitor(db: Db, id: string): boolean {
	return db.prepare('DELETE FROM monitors WHERE id = ?').run(id).changes > 0;
}

/** Enabled monitors whose next check is due. */
export function dueMonitors(db: Db, now = Date.now()): Monitor[] {
	return (
		db
			.prepare(
				`SELECT * FROM monitors WHERE enabled = 1
				 AND (last_checked_at IS NULL OR last_checked_at + interval_seconds * 1000 <= ?)`
			)
			.all(now) as MonitorRow[]
	).map((r) => toMonitor(db, r));
}

export interface CheckOutcome {
	status: 'up' | 'down' | 'pending';
	latencyMs: number | null;
	message: string | null;
}

/**
 * Stores a check's result. A failure only turns the monitor down once it failed
 * `retries` + 1 times in a row; until then it is pending. Returns the status
 * before and after, so callers can tell a change.
 */
export function recordCheck(
	db: Db,
	id: string,
	outcome: CheckOutcome,
	now = Date.now()
): { previous: MonitorStatus; status: Heartbeat['status'] } | undefined {
	return db.transaction(() => {
		const row = db
			.prepare('SELECT status, failures, retries, enabled FROM monitors WHERE id = ?')
			.get(id) as Pick<MonitorRow, 'status' | 'failures' | 'retries' | 'enabled'> | undefined;
		// Deleted, or paused while the check ran.
		if (!row || row.enabled !== 1) return undefined;
		const failures = outcome.status === 'down' ? row.failures + 1 : 0;
		const status: Heartbeat['status'] =
			outcome.status === 'down' && failures <= row.retries ? 'pending' : outcome.status;
		db.prepare(
			`UPDATE monitors SET status = ?, message = ?, latency_ms = ?, failures = ?, last_checked_at = ?,
			 last_change_at = CASE WHEN status = ? THEN last_change_at ELSE ? END
			 WHERE id = ?`
		).run(status, outcome.message, outcome.latencyMs, failures, now, status, now, id);
		db.prepare(
			'INSERT INTO heartbeats (monitor_id, status, latency_ms, message, checked_at) VALUES (?, ?, ?, ?, ?)'
		).run(id, status, outcome.latencyMs, outcome.message, now);
		return { previous: row.status, status };
	})();
}

/** The latest `limit` checks of each monitor, oldest first. */
export function recentHeartbeats(db: Db, ids: string[], limit: number): Map<string, Heartbeat[]> {
	const result = new Map<string, Heartbeat[]>(ids.map((id) => [id, []]));
	if (ids.length === 0) return result;
	const rows = db
		.prepare(
			`SELECT monitor_id, status, latency_ms, message, checked_at FROM (
				SELECT h.*, ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC) AS rn
				FROM heartbeats h WHERE monitor_id IN (${ids.map(() => '?').join(',')})
			) WHERE rn <= ? ORDER BY checked_at`
		)
		.all(...ids, limit) as HeartbeatRow[];
	for (const row of rows) result.get(row.monitor_id)?.push(toHeartbeat(row));
	return result;
}

/** A monitor's checks since `since`, oldest first. */
export function heartbeatsSince(db: Db, id: string, since: number, limit = 5000): Heartbeat[] {
	return (
		db
			.prepare(
				`SELECT * FROM (
					SELECT monitor_id, status, latency_ms, message, checked_at FROM heartbeats
					WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at DESC LIMIT ?
				) ORDER BY checked_at`
			)
			.all(id, since, limit) as HeartbeatRow[]
	).map(toHeartbeat);
}

/** Status changes (the first check, and each one whose status differs from the one before). */
export function statusChanges(db: Db, id: string, limit = 50): Heartbeat[] {
	return (
		db
			.prepare(
				`SELECT monitor_id, status, latency_ms, message, checked_at FROM (
					SELECT h.*, LAG(status) OVER (ORDER BY checked_at) AS prev
					FROM heartbeats h WHERE monitor_id = ?
				) WHERE prev IS NULL OR prev <> status ORDER BY checked_at DESC LIMIT ?`
			)
			.all(id, limit) as HeartbeatRow[]
	).map(toHeartbeat);
}

/** Uptime over the last day, week and 30 days: up checks over up + down ones. */
export function uptimes(db: Db, ids: string[], now = Date.now()): Map<string, Uptime> {
	const result = new Map<string, Uptime>(
		ids.map((id) => [id, { day: null, week: null, month: null }])
	);
	if (ids.length === 0) return result;
	const rows = db
		.prepare(
			`SELECT monitor_id,
				SUM(CASE WHEN checked_at >= @day AND status = 'up' THEN 1 ELSE 0 END) AS day_up,
				SUM(CASE WHEN checked_at >= @day AND status IN ('up','down') THEN 1 ELSE 0 END) AS day_all,
				SUM(CASE WHEN checked_at >= @week AND status = 'up' THEN 1 ELSE 0 END) AS week_up,
				SUM(CASE WHEN checked_at >= @week AND status IN ('up','down') THEN 1 ELSE 0 END) AS week_all,
				SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS month_up,
				SUM(CASE WHEN status IN ('up','down') THEN 1 ELSE 0 END) AS month_all
			FROM heartbeats
			WHERE checked_at >= @month AND monitor_id IN (${ids.map((_, i) => `@id${i}`).join(',')})
			GROUP BY monitor_id`
		)
		.all({
			day: now - DAY_MS,
			week: now - 7 * DAY_MS,
			month: now - 30 * DAY_MS,
			...Object.fromEntries(ids.map((id, i) => [`id${i}`, id]))
		}) as {
		monitor_id: string;
		day_up: number;
		day_all: number;
		week_up: number;
		week_all: number;
		month_up: number;
		month_all: number;
	}[];
	const pct = (up: number, all: number) => (all > 0 ? Math.round((up / all) * 10_000) / 100 : null);
	for (const r of rows) {
		result.set(r.monitor_id, {
			day: pct(r.day_up, r.day_all),
			week: pct(r.week_up, r.week_all),
			month: pct(r.month_up, r.month_all)
		});
	}
	return result;
}

/** Monitors with their latest checks and uptime, as the dashboard and API list them. */
export function listMonitorSummaries(db: Db, recent = 50): MonitorSummary[] {
	const monitors = listMonitors(db);
	const ids = monitors.map((m) => m.id);
	const beats = recentHeartbeats(db, ids, recent);
	const up = uptimes(db, ids);
	return monitors.map((m) => ({ ...m, recent: beats.get(m.id) ?? [], uptime: up.get(m.id)! }));
}

export function getMonitorSummary(db: Db, id: string, recent = 50): MonitorSummary | undefined {
	const m = getMonitor(db, id);
	if (!m) return undefined;
	return {
		...m,
		recent: recentHeartbeats(db, [id], recent).get(id) ?? [],
		uptime: uptimes(db, [id]).get(id)!
	};
}

/** The public status page: public monitors with daily uptime over `days` days (UTC). */
export function listPublicMonitors(db: Db, days = 90, now = Date.now()): PublicMonitor[] {
	const monitors = listMonitors(db, { publicOnly: true });
	const ids = monitors.map((m) => m.id);
	const up = uptimes(db, ids, now);
	const start = Math.floor(now / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;
	const rows = ids.length
		? (db
				.prepare(
					`SELECT monitor_id, (checked_at / ${DAY_MS}) AS day,
						SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
						SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down
					FROM heartbeats WHERE checked_at >= ? AND monitor_id IN (${ids.map(() => '?').join(',')})
					GROUP BY monitor_id, day`
				)
				.all(start, ...ids) as { monitor_id: string; day: number; up: number; down: number }[])
		: [];
	const byMonitor = new Map<string, Map<number, { up: number; down: number }>>();
	for (const r of rows) {
		if (!byMonitor.has(r.monitor_id)) byMonitor.set(r.monitor_id, new Map());
		byMonitor.get(r.monitor_id)!.set(r.day, r);
	}
	return monitors.map((m) => {
		const buckets = byMonitor.get(m.id);
		const series = Array.from({ length: days }, (_, i) => {
			const dayStart = start + i * DAY_MS;
			const b = buckets?.get(dayStart / DAY_MS);
			const total = b ? b.up + b.down : 0;
			return {
				date: new Date(dayStart).toISOString().slice(0, 10),
				uptime: total > 0 ? Math.round((b!.up / total) * 10_000) / 100 : null,
				down: b?.down ?? 0
			};
		});
		return {
			id: m.id,
			name: m.name,
			description: m.description,
			type: m.type,
			status: m.status,
			latencyMs: m.latencyMs,
			lastCheckedAt: m.lastCheckedAt,
			faviconUrl: m.faviconUrl,
			uptime: up.get(m.id)!,
			days: series
		};
	});
}

/** Drops checks older than `days` days. */
export function pruneHeartbeats(db: Db, days: number, now = Date.now()): number {
	return db.prepare('DELETE FROM heartbeats WHERE checked_at < ?').run(now - days * DAY_MS).changes;
}
