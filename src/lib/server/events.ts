// An in-process event bus for live updates: the checker and monitor changes
// publish here, and the SSE endpoints (/api/events, /api/public/events) relay it.

import type { Heartbeat, Monitor, PublicEvent, ServerEvent } from '$lib/types.js';
import { createLogger } from './logger.js';

const log = createLogger('events');

type Listener<E> = (event: E) => void;

interface Bus {
	private: Set<Listener<ServerEvent>>;
	public: Set<Listener<PublicEvent>>;
}

// Kept on globalThis so the dev server's module reloads share one bus.
const state = globalThis as { __stattyBus?: Bus };
const bus = (state.__stattyBus ??= { private: new Set(), public: new Set() });

function emit<E>(listeners: Set<Listener<E>>, event: E) {
	for (const listener of [...listeners]) {
		try {
			listener(event);
		} catch (e) {
			log.error('Event listener failed', { error: String(e) });
		}
	}
}

export function subscribe(listener: Listener<ServerEvent>): () => void {
	bus.private.add(listener);
	return () => bus.private.delete(listener);
}

export function subscribePublic(listener: Listener<PublicEvent>): () => void {
	bus.public.add(listener);
	return () => bus.public.delete(listener);
}

/** A finished check: the dashboard gets everything, the public page only what it shows. */
export function publishCheck(monitor: Monitor, heartbeat: Heartbeat) {
	emit(bus.private, {
		type: 'monitor.checked',
		monitorId: monitor.id,
		heartbeat,
		state: {
			status: monitor.status,
			message: monitor.message,
			latencyMs: monitor.latencyMs,
			lastCheckedAt: monitor.lastCheckedAt,
			lastChangeAt: monitor.lastChangeAt
		}
	});
	if (monitor.public) {
		emit(bus.public, {
			type: 'monitor.checked',
			monitorId: monitor.id,
			status: monitor.status,
			latencyMs: monitor.latencyMs,
			lastCheckedAt: monitor.lastCheckedAt
		});
	}
}

/** A monitor was created, edited or deleted. */
export function publishChange(monitorId: string, deleted = false) {
	emit(bus.private, { type: deleted ? 'monitor.deleted' : 'monitor.changed', monitorId });
	emit(bus.public, { type: 'monitors.changed' });
}

/** An SSE response that relays `subscribe`'s events until the client goes away. */
export function eventStream<E>(
	request: Request,
	subscribeTo: (listener: Listener<E>) => () => void
): Response {
	const encoder = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup();
				}
			};
			const unsubscribe = subscribeTo((event) => send(`data: ${JSON.stringify(event)}\n\n`));
			// Comments keep proxies from closing an idle stream.
			const heartbeat = setInterval(() => send(': ping\n\n'), 25_000);
			cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			request.signal.addEventListener('abort', () => cleanup());
			send('retry: 3000\n: connected\n\n');
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no'
		}
	});
}
