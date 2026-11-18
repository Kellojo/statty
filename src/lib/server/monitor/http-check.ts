import { Agent, fetch } from 'undici';
import type { Monitor } from '$lib/types.js';
import type { CheckOutcome } from '../db/repo/monitors.js';
import { isAcceptedStatus } from './input.js';

/** Keyword checks read at most this much of the body. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const USER_AGENT = 'Statty/1.0 (uptime monitor)';

async function readText(body: AsyncIterable<Uint8Array> | null): Promise<string> {
	if (!body) return '';
	const chunks: Uint8Array[] = [];
	let size = 0;
	// Leaving the loop early cancels the rest of the stream.
	for await (const chunk of body) {
		chunks.push(chunk);
		size += chunk.byteLength;
		if (size >= MAX_BODY_BYTES) break;
	}
	return Buffer.concat(chunks).toString('utf8');
}

/** The deepest cause's message: undici wraps network errors as "fetch failed". */
function errorMessage(e: unknown): string {
	let err = e as { message?: string; cause?: unknown; code?: string } | undefined;
	let message = err?.message ?? String(e);
	while (err?.cause && typeof err.cause === 'object') {
		err = err.cause as typeof err;
		if (err?.message) message = err.code ? `${err.code}: ${err.message}` : err.message;
	}
	return message;
}

export async function checkHttp(monitor: Monitor): Promise<CheckOutcome> {
	const started = performance.now();
	const signal = AbortSignal.timeout(monitor.timeoutSeconds * 1000);
	try {
		const res = await fetch(monitor.url!, {
			method: monitor.method,
			redirect: 'follow',
			signal,
			headers: { 'user-agent': USER_AGENT, accept: '*/*' },
			...(monitor.ignoreTls ? { dispatcher: insecureAgent } : {})
		});
		const body = monitor.keyword && monitor.method !== 'HEAD' ? await readText(res.body) : null;
		if (body === null) await res.body?.cancel().catch(() => undefined);
		const latencyMs = Math.round(performance.now() - started);
		if (!isAcceptedStatus(res.status, monitor.acceptedStatuses)) {
			return {
				status: 'down',
				latencyMs,
				message: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
			};
		}
		if (monitor.keyword && !(body ?? '').includes(monitor.keyword)) {
			return { status: 'down', latencyMs, message: `Keyword "${monitor.keyword}" not found` };
		}
		return { status: 'up', latencyMs, message: `HTTP ${res.status}` };
	} catch (e) {
		const timedOut = signal.aborted;
		return {
			status: 'down',
			latencyMs: null,
			message: timedOut ? `Timed out after ${monitor.timeoutSeconds}s` : errorMessage(e)
		};
	}
}
