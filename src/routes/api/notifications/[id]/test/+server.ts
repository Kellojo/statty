import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { appOrigin } from '$lib/server/config.js';
import { getDb } from '$lib/server/db/index.js';
import { getChannel } from '$lib/server/db/repo/notifications.js';
import { sendTestNotification } from '$lib/server/notifications/index.js';
import type { RequestHandler } from './$types';

/** Sends a test message, even to a turned-off channel; a 502 carries the channel's error. */
export const POST: RequestHandler = async ({ locals, params, url }) => {
	requireAdmin(locals);
	const channel = getChannel(getDb(), params.id);
	if (!channel) error(404, { message: 'Notification channel not found' });
	try {
		await sendTestNotification(channel, appOrigin(url.origin));
	} catch (e) {
		error(502, { message: e instanceof Error ? e.message : 'Sending failed' });
	}
	return json({ ok: true });
};
