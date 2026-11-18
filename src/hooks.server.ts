import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth/index.js';
import { csrfHandle } from '$lib/server/csrf.js';
import { closeDb } from '$lib/server/db/index.js';
import { startScheduler, stopScheduler } from '$lib/server/monitor/scheduler.js';

const shutdown = globalThis as { __stattyShutdownRegistered?: boolean };

if (!building) {
	startScheduler();
	if (!shutdown.__stattyShutdownRegistered) {
		shutdown.__stattyShutdownRegistered = true;
		// adapter-node closes the HTTP server on these signals; stop the checks and the database too.
		for (const signal of ['SIGINT', 'SIGTERM'] as const) {
			process.once(signal, () => {
				stopScheduler();
				closeDb();
			});
		}
	}
}

const authRoutes: Handle = ({ event, resolve }) =>
	svelteKitHandler({ event, resolve, auth, building });

const sessionHandle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;
	return resolve(event);
};

export const handle: Handle = sequence(csrfHandle, authRoutes, sessionHandle);
