// A live connection to one of Statty's SSE streams (/api/events or /api/public/events).
// Pages read `connected` for the live indicator and add listeners for events.
// After a reconnect, `onResync` listeners run so pages can reload what they missed.

import { invalidateAll } from '$app/navigation';

type Listener<E> = (event: E) => void;

export class LiveStream<E> {
	/** Whether the stream is open right now. */
	connected = $state(false);
	#source: EventSource | null = null;
	// Bookkeeping, not rendered state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#listeners = new Set<Listener<E>>();
	#users = 0;
	#openedOnce = false;
	#url: string;

	constructor(url: string) {
		this.#url = url;
	}

	/** Listens until the returned cleanup runs; the stream stays open while anyone listens. */
	listen(listener: Listener<E>): () => void {
		this.#listeners.add(listener);
		this.#users++;
		this.#open();
		return () => {
			this.#listeners.delete(listener);
			if (--this.#users === 0) this.#close();
		};
	}

	#open() {
		if (this.#source || typeof EventSource === 'undefined') return;
		const source = new EventSource(this.#url);
		this.#source = source;
		source.onopen = () => {
			if (this.#source !== source) return;
			this.connected = true;
			// Events sent while we were away are lost: reload the page's data.
			if (this.#openedOnce) void refreshSoon(0);
			this.#openedOnce = true;
		};
		source.onerror = () => {
			// EventSource reconnects by itself (the server asks for 3s).
			if (this.#source === source) this.connected = false;
		};
		source.onmessage = (msg) => {
			if (this.#source !== source) return;
			let event: E;
			try {
				event = JSON.parse(msg.data) as E;
			} catch {
				return;
			}
			for (const listener of [...this.#listeners]) {
				try {
					listener(event);
				} catch (e) {
					console.error('Live event listener failed', e);
				}
			}
		};
	}

	#close() {
		this.#source?.close();
		this.#source = null;
		this.#openedOnce = false;
		this.connected = false;
	}
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Reloads the page's data once after `delayMs`, folding the calls made meanwhile
 * into one (a burst of changes reloads once).
 */
export function refreshSoon(delayMs = 400): void {
	if (refreshTimer) return;
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		void invalidateAll();
	}, delayMs);
}

/**
 * Falls back to reloading every `ms` while `stream` is down (e.g. a proxy that
 * buffers event streams). Call inside `$effect`; returns the cleanup.
 */
export function pollWhileDisconnected<E>(stream: LiveStream<E>, ms = 15_000): (() => void) | void {
	if (stream.connected) return;
	const timer = setInterval(() => {
		if (document.visibilityState === 'visible') void invalidateAll();
	}, ms);
	return () => clearInterval(timer);
}
