import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import { deleteChannel, getChannel } from '$lib/server/db/repo/notifications.js';
import { asBadRequest, readBody } from '$lib/server/http.js';
import {
	channelUpdateSchema,
	toPublicChannel,
	updateNotificationChannel
} from '$lib/server/notifications/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	const channel = getChannel(getDb(), params.id);
	if (!channel) error(404, { message: 'Notification channel not found' });
	return json({ channel: toPublicChannel(channel) });
};

/** Changes fields; a blank or missing config.token keeps the stored one. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	const body = await readBody(request, channelUpdateSchema);
	const channel = await asBadRequest(() => updateNotificationChannel(getDb(), params.id, body));
	if (!channel) error(404, { message: 'Notification channel not found' });
	return json({ channel });
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	if (!deleteChannel(getDb(), params.id)) error(404, { message: 'Notification channel not found' });
	return json({ ok: true });
};
