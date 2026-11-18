import { eventStream, subscribePublic } from '$lib/server/events.js';
import type { RequestHandler } from './$types';

/** Live status of public monitors for the status page (SSE, no sign-in, no targets or messages). */
export const GET: RequestHandler = ({ request }) => eventStream(request, subscribePublic);
