// What a notification channel type implements. To add one (ntfy, webhook, …): add its
// name to NOTIFICATION_TYPES and its public config to NotificationPublicConfigs in
// $lib/types.ts, write a driver like gotify.ts, and register it in index.ts.

import type { z } from 'zod';
import type { NotificationPublicConfigs, NotificationType } from '$lib/types.js';
import type { NotificationMessage } from './message.js';

/** A bad channel field; routes turn it into a 400 with this message. */
export class NotificationInputError extends Error {}

export interface ChannelDriver<T extends NotificationType> {
	/** Shown in the UI and logs, e.g. "Gotify". */
	label: string;
	/**
	 * Validates config sent by a client and returns it as stored (secrets encrypted).
	 * `existing` is the stored config when editing, so secrets left blank are kept.
	 * Throws NotificationInputError.
	 */
	configFromInput(input: unknown, existing: unknown | null): unknown;
	/** What the browser may see: never secrets. */
	toPublic(stored: unknown): NotificationPublicConfigs[T];
	/** Sends one message; throws with a readable reason on failure. */
	send(stored: unknown, message: NotificationMessage): Promise<void>;
}

/** Parses a driver's config input, naming the first problem as `config.<field>: …`. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input ?? {});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw configError(issue?.path.join('.') ?? '', issue?.message ?? 'Invalid config');
	}
	return parsed.data;
}

export function configError(field: string, message: string): NotificationInputError {
	return new NotificationInputError(field ? `config.${field}: ${message}` : `config: ${message}`);
}
