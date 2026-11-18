import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import { asBadRequest, readBody } from '$lib/server/http.js';
import {
	channelCreateSchema,
	createNotificationChannel,
	listNotificationChannels
} from '$lib/server/notifications/index.js';
import type { RequestHandler } from './$types';

// Channels are instance-wide, so only admins manage them (signed in; API keys can't).
export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	return json({ channels: listNotificationChannels(getDb()) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);
	const body = await readBody(request, channelCreateSchema);
	const channel = await asBadRequest(() => createNotificationChannel(getDb(), body));
	return json({ channel }, { status: 201 });
};
