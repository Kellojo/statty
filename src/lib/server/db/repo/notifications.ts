// Notification channels as stored. The config column is opaque JSON here; the
// channel drivers (src/lib/server/notifications/) parse it and hold the secrets' rules.

import { randomUUID } from 'node:crypto';
import type { Db } from '../index.js';

export interface NotificationChannelRow {
	id: string;
	name: string;
	type: string;
	config: string;
	enabled: number;
	all_monitors: number;
	created_at: number;
	updated_at: number;
}

/** A row with its chosen monitors (empty when it covers all monitors). */
export interface StoredChannel {
	id: string;
	name: string;
	type: string;
	/** Parsed JSON, still in its stored form (secrets encrypted). */
	config: unknown;
	enabled: boolean;
	allMonitors: boolean;
	monitorIds: string[];
	createdAt: number;
	updatedAt: number;
}

export interface ChannelWrite {
	name: string;
	type: string;
	config: unknown;
	enabled: boolean;
	allMonitors: boolean;
	monitorIds: string[];
}

function parseConfig(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function monitorIdsByChannel(db: Db, ids: string[]): Map<string, string[]> {
	const result = new Map<string, string[]>(ids.map((id) => [id, []]));
	if (ids.length === 0) return result;
	const rows = db
		.prepare(
			`SELECT channel_id, monitor_id FROM notification_channel_monitors
			 WHERE channel_id IN (${ids.map(() => '?').join(',')})`
		)
		.all(...ids) as { channel_id: string; monitor_id: string }[];
	for (const r of rows) result.get(r.channel_id)?.push(r.monitor_id);
	return result;
}

function toStored(row: NotificationChannelRow, monitorIds: string[]): StoredChannel {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		config: parseConfig(row.config),
		enabled: row.enabled === 1,
		allMonitors: row.all_monitors === 1,
		monitorIds: row.all_monitors === 1 ? [] : monitorIds,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function withMonitors(db: Db, rows: NotificationChannelRow[]): StoredChannel[] {
	const byChannel = monitorIdsByChannel(
		db,
		rows.map((r) => r.id)
	);
	return rows.map((r) => toStored(r, byChannel.get(r.id) ?? []));
}

export function listChannels(db: Db): StoredChannel[] {
	const rows = db
		.prepare('SELECT * FROM notification_channels ORDER BY name COLLATE NOCASE, created_at')
		.all() as NotificationChannelRow[];
	return withMonitors(db, rows);
}

export function getChannel(db: Db, id: string): StoredChannel | undefined {
	const row = db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id) as
		NotificationChannelRow | undefined;
	return row ? withMonitors(db, [row])[0] : undefined;
}

/** Enabled channels that cover a monitor: all-monitor ones and those that chose it. */
export function channelsForMonitor(db: Db, monitorId: string): StoredChannel[] {
	const rows = db
		.prepare(
			`SELECT c.* FROM notification_channels c
			 WHERE c.enabled = 1 AND (c.all_monitors = 1 OR EXISTS (
				SELECT 1 FROM notification_channel_monitors m
				WHERE m.channel_id = c.id AND m.monitor_id = ?
			 ))
			 ORDER BY c.created_at`
		)
		.all(monitorId) as NotificationChannelRow[];
	return rows.map((r) => toStored(r, []));
}

/** The ids among `ids` that are not monitors. */
export function unknownMonitorIds(db: Db, ids: string[]): string[] {
	if (ids.length === 0) return [];
	const found = new Set(
		(
			db
				.prepare(`SELECT id FROM monitors WHERE id IN (${ids.map(() => '?').join(',')})`)
				.all(...ids) as { id: string }[]
		).map((r) => r.id)
	);
	return ids.filter((id) => !found.has(id));
}

function writeMonitors(db: Db, channelId: string, write: ChannelWrite) {
	db.prepare('DELETE FROM notification_channel_monitors WHERE channel_id = ?').run(channelId);
	if (write.allMonitors) return;
	const insert = db.prepare(
		'INSERT OR IGNORE INTO notification_channel_monitors (channel_id, monitor_id) VALUES (?, ?)'
	);
	for (const monitorId of write.monitorIds) insert.run(channelId, monitorId);
}

export function createChannel(db: Db, write: ChannelWrite): StoredChannel {
	const id = randomUUID();
	const now = Date.now();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO notification_channels
			 (id, name, type, config, enabled, all_monitors, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			id,
			write.name,
			write.type,
			JSON.stringify(write.config),
			write.enabled ? 1 : 0,
			write.allMonitors ? 1 : 0,
			now,
			now
		);
		writeMonitors(db, id, write);
	})();
	return getChannel(db, id)!;
}

/** Replaces a channel's fields (the type stays); undefined if it doesn't exist. */
export function updateChannel(
	db: Db,
	id: string,
	write: Omit<ChannelWrite, 'type'>
): StoredChannel | undefined {
	const current = getChannel(db, id);
	if (!current) return undefined;
	db.transaction(() => {
		db.prepare(
			`UPDATE notification_channels
			 SET name = ?, config = ?, enabled = ?, all_monitors = ?, updated_at = ? WHERE id = ?`
		).run(
			write.name,
			JSON.stringify(write.config),
			write.enabled ? 1 : 0,
			write.allMonitors ? 1 : 0,
			Date.now(),
			id
		);
		writeMonitors(db, id, { ...write, type: current.type });
	})();
	return getChannel(db, id);
}

export function deleteChannel(db: Db, id: string): boolean {
	return db.prepare('DELETE FROM notification_channels WHERE id = ?').run(id).changes > 0;
}

/** The status of a monitor's latest up or down check before `before` (pending ones skipped). */
export function lastSettledStatus(db: Db, monitorId: string, before: number): 'up' | 'down' | null {
	const row = db
		.prepare(
			`SELECT status FROM heartbeats
			 WHERE monitor_id = ? AND checked_at < ? AND status IN ('up', 'down')
			 ORDER BY checked_at DESC LIMIT 1`
		)
		.get(monitorId, before) as { status: 'up' | 'down' } | undefined;
	return row?.status ?? null;
}

/** When the outage ending at `before` began: the first down check since the last up one. */
export function outageStart(db: Db, monitorId: string, before: number): number | null {
	const row = db
		.prepare(
			`SELECT MIN(checked_at) AS since FROM heartbeats
			 WHERE monitor_id = @id AND status = 'down' AND checked_at < @before
			 AND checked_at > COALESCE((
				SELECT MAX(checked_at) FROM heartbeats
				WHERE monitor_id = @id AND status = 'up' AND checked_at < @before
			 ), 0)`
		)
		.get({ id: monitorId, before }) as { since: number | null } | undefined;
	return row?.since ?? null;
}
