// Notification channels: managing them, and sending when a check changes a
// monitor's status. Sending never blocks checks: notifyCheck runs in the
// background and only logs failures.

import { z } from 'zod';
import {
	NOTIFICATION_TYPES,
	type Heartbeat,
	type Monitor,
	type MonitorStatus,
	type NotificationChannel,
	type NotificationType
} from '$lib/types.js';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import {
	channelsForMonitor,
	createChannel,
	getChannel,
	lastSettledStatus,
	listChannels,
	outageStart,
	unknownMonitorIds,
	updateChannel,
	type StoredChannel
} from '../db/repo/notifications.js';
import { createLogger } from '../logger.js';
import { type ChannelDriver, NotificationInputError } from './driver.js';
import { gotifyDriver } from './gotify.js';
import { monitorMessage, notifyEvent, testMessage, type NotificationMessage } from './message.js';

export { NotificationInputError } from './driver.js';

const log = createLogger('notify');

const DRIVERS: { [T in NotificationType]: ChannelDriver<T> } = {
	gotify: gotifyDriver
};

function driverFor(type: string): ChannelDriver<NotificationType> {
	if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
		throw new Error(`Unknown notification channel type "${type}"`);
	}
	return DRIVERS[type as NotificationType];
}

/** Where links in messages point: ORIGIN, or the local server when it isn't set. */
export function notificationOrigin(): string {
	return (config.ORIGIN ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, '');
}

export function toPublicChannel(channel: StoredChannel): NotificationChannel {
	const type = channel.type as NotificationType;
	return {
		id: channel.id,
		name: channel.name,
		type,
		config: driverFor(type).toPublic(channel.config),
		enabled: channel.enabled,
		allMonitors: channel.allMonitors,
		monitorIds: channel.monitorIds,
		createdAt: channel.createdAt,
		updatedAt: channel.updatedAt
	};
}

/** Channels the browser may see; rows of an unknown type (a newer version's) are skipped. */
export function listNotificationChannels(db: Db): NotificationChannel[] {
	return listChannels(db)
		.filter((c) => (NOTIFICATION_TYPES as readonly string[]).includes(c.type))
		.map(toPublicChannel);
}

const fields = {
	name: z.string().trim().min(1, 'Name the channel').max(100),
	enabled: z.boolean(),
	allMonitors: z.boolean(),
	monitorIds: z.array(z.string().min(1).max(100)).max(5000),
	/** Validated by the type's driver. */
	config: z.unknown()
};

export const channelCreateSchema = z.object({
	type: z.enum(NOTIFICATION_TYPES),
	name: fields.name,
	enabled: fields.enabled.default(true),
	allMonitors: fields.allMonitors.default(true),
	monitorIds: fields.monitorIds.default([]),
	config: fields.config
});
export type ChannelCreateInput = z.infer<typeof channelCreateSchema>;

/** The type can't change; config is required in full except secrets, which stay when blank. */
export const channelUpdateSchema = z.object(fields).partial();
export type ChannelUpdateInput = z.infer<typeof channelUpdateSchema>;

function checkScope(db: Db, allMonitors: boolean, monitorIds: string[]): string[] {
	if (allMonitors) return [];
	const ids = [...new Set(monitorIds)];
	if (ids.length === 0) throw new NotificationInputError('monitorIds: Choose at least one monitor');
	if (unknownMonitorIds(db, ids).length > 0) {
		throw new NotificationInputError('monitorIds: Unknown monitor');
	}
	return ids;
}

/** Throws NotificationInputError for bad fields. */
export function createNotificationChannel(db: Db, input: ChannelCreateInput): NotificationChannel {
	const driver = driverFor(input.type);
	const stored = createChannel(db, {
		name: input.name,
		type: input.type,
		config: driver.configFromInput(input.config, null),
		enabled: input.enabled,
		allMonitors: input.allMonitors,
		monitorIds: checkScope(db, input.allMonitors, input.monitorIds)
	});
	return toPublicChannel(stored);
}

/** Undefined if the channel doesn't exist; throws NotificationInputError for bad fields. */
export function updateNotificationChannel(
	db: Db,
	id: string,
	input: ChannelUpdateInput
): NotificationChannel | undefined {
	const current = getChannel(db, id);
	if (!current) return undefined;
	const driver = driverFor(current.type);
	const allMonitors = input.allMonitors ?? current.allMonitors;
	const updated = updateChannel(db, id, {
		name: input.name ?? current.name,
		config:
			input.config === undefined
				? current.config
				: driver.configFromInput(input.config, current.config),
		enabled: input.enabled ?? current.enabled,
		allMonitors,
		monitorIds: checkScope(db, allMonitors, input.monitorIds ?? current.monitorIds)
	});
	return updated && toPublicChannel(updated);
}

/** Sends one message to a channel; throws with the channel's error. */
export function sendToChannel(channel: StoredChannel, message: NotificationMessage): Promise<void> {
	return driverFor(channel.type).send(channel.config, message);
}

export function sendTestNotification(channel: StoredChannel, origin: string): Promise<void> {
	return sendToChannel(channel, testMessage(channel.name, origin));
}

/**
 * After a check is recorded: sends to the monitor's channels if it went down or
 * came back up. Resolves once every send has finished; never rejects. The
 * scheduler doesn't wait for it, so a slow channel never delays checks.
 */
export async function notifyCheck(
	db: Db,
	monitor: Monitor,
	change: { previous: MonitorStatus; status: Heartbeat['status'] },
	outcome: { message: string | null; latencyMs: number | null },
	at: number,
	origin = notificationOrigin()
): Promise<void> {
	// Most checks change nothing; skip them before touching the database.
	if (change.previous === change.status || change.status === 'pending') return;
	let channels: StoredChannel[];
	let message: NotificationMessage;
	try {
		const settled = change.previous === 'pending' ? lastSettledStatus(db, monitor.id, at) : null;
		const event = notifyEvent(change.previous, change.status, settled);
		if (!event) return;
		channels = channelsForMonitor(db, monitor.id).filter((c) =>
			(NOTIFICATION_TYPES as readonly string[]).includes(c.type)
		);
		if (channels.length === 0) return;
		message = monitorMessage({
			monitor,
			event,
			message: outcome.message,
			latencyMs: outcome.latencyMs,
			downSince: event === 'up' ? outageStart(db, monitor.id, at) : null,
			at,
			origin
		});
	} catch (e) {
		log.error('Could not prepare notifications', { monitorId: monitor.id, error: String(e) });
		return;
	}
	await Promise.all(
		channels.map(async (channel) => {
			try {
				await sendToChannel(channel, message);
				log.info(`Sent "${message.title}" to ${channel.name}`, { channelId: channel.id });
			} catch (e) {
				log.warn(`Notification to ${channel.name} failed`, {
					channelId: channel.id,
					monitorId: monitor.id,
					error: e instanceof Error ? e.message : String(e)
				});
			}
		})
	);
}
