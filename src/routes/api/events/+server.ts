import { requireUser } from '$lib/server/auth/guards.js';
import { eventStream, subscribe } from '$lib/server/events.js';
import type { RequestHandler } from './$types';

/** Live check results and monitor changes for the signed-in dashboard (SSE). */
export const GET: RequestHandler = ({ locals, request }) => {
	requireUser(locals);
	return eventStream(request, subscribe);
};
