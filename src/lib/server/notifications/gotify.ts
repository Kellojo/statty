// Gotify (https://gotify.net): POST {url}/message with an application token.

import { z } from 'zod';
import type { GotifyPublicConfig } from '$lib/types.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { type ChannelDriver, configError, parseInput } from './driver.js';
import type { NotificationMessage } from './message.js';

export const GOTIFY_DEFAULT_PRIORITY = 8;
const TIMEOUT_MS = 10_000;

/** As stored: the token is encrypted with the app secret. */
interface GotifyStored {
	url: string;
	token: string;
	priority: number;
}

/** Decrypted, ready to send with. */
export interface GotifyTarget {
	url: string;
	token: string;
	priority: number;
}

const urlSchema = z
	.string()
	.trim()
	.min(1, 'Enter the Gotify server URL')
	.max(500)
	.refine((v) => {
		try {
			return ['http:', 'https:'].includes(new URL(v).protocol);
		} catch {
			return false;
		}
	}, 'Enter an http(s) URL, e.g. https://push.example.com')
	// Gotify may live under a path (https://example.com/gotify); keep it, minus the trailing slash.
	.transform((v) => v.replace(/\/+$/, ''));

const inputSchema = z.object({
	url: urlSchema,
	/** Blank or left out on edit keeps the stored token. */
	token: z.string().trim().max(500).optional(),
	priority: z
		.number()
		.int('Priority is a whole number')
		.min(0, 'Priority is 0–10')
		.max(10, 'Priority is 0–10')
		.default(GOTIFY_DEFAULT_PRIORITY)
});

const storedSchema = z.object({
	url: z.string(),
	token: z.string(),
	priority: z.number().int().catch(GOTIFY_DEFAULT_PRIORITY)
});

function stored(raw: unknown): GotifyStored {
	return storedSchema.parse(raw);
}

/** The JSON body Gotify's POST /message takes. */
export function gotifyPayload(message: NotificationMessage, priority: number) {
	const extras: Record<string, unknown> = {
		'client::display': { contentType: 'text/markdown' }
	};
	if (message.url) extras['client::notification'] = { click: { url: message.url } };
	return { title: message.title, message: message.body, priority, extras };
}

/** The deepest cause of a network error: fetch wraps them all as "fetch failed". */
function rootCause(e: unknown): { code?: string; message: string } {
	let err = e as { message?: string; cause?: unknown; code?: string } | undefined;
	let found = { code: err?.code, message: err?.message ?? String(e) };
	while (err?.cause && typeof err.cause === 'object') {
		err = err.cause as typeof err;
		if (err?.message) found = { code: err.code, message: err.message };
	}
	return found;
}

/** A network failure in words an admin can act on; the raw reason only when it's unusual. */
export function describeNetworkError(e: unknown, url: string): string {
	const host = (() => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	})();
	const { code, message } = rootCause(e);
	switch (code) {
		case 'ENOTFOUND':
		case 'EAI_AGAIN':
			return `Couldn't find ${host}. Check the server URL.`;
		case 'ECONNREFUSED':
			return `${host} refused the connection. Check the URL and that Gotify is running.`;
		case 'ECONNRESET':
		case 'UND_ERR_SOCKET':
			return `${host} closed the connection. Check the URL and port.`;
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return `${host} can't be reached from this server.`;
	}
	if (code?.startsWith('ERR_TLS') || /certificate|self.signed|SSL/i.test(message)) {
		return `${host}'s TLS certificate isn't trusted (${message}).`;
	}
	if (/redirect/i.test(message)) {
		return `${host} redirected the request. Use the final URL, e.g. with https://.`;
	}
	return `Couldn't reach ${host}: ${message}`;
}

/** Sends one message; throws with Gotify's own error (or the network's) on failure. */
export async function sendGotify(
	target: GotifyTarget,
	message: NotificationMessage
): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`${target.url}/message`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-gotify-key': target.token },
			body: JSON.stringify(gotifyPayload(message, target.priority)),
			signal: AbortSignal.timeout(TIMEOUT_MS),
			redirect: 'error'
		});
	} catch (e) {
		if (e instanceof Error && e.name === 'TimeoutError') {
			throw new Error(`Gotify didn't answer within ${TIMEOUT_MS / 1000}s.`, { cause: e });
		}
		throw new Error(describeNetworkError(e, target.url), { cause: e });
	}
	if (res.ok) {
		await res.body?.cancel();
		return;
	}
	// Gotify errors look like {"error":"Unauthorized","errorCode":401,"errorDescription":"…"}.
	const payload = (await res.json().catch(() => null)) as {
		error?: string;
		errorDescription?: string;
	} | null;
	const detail = payload?.errorDescription || payload?.error || res.statusText;
	if (res.status === 401 || res.status === 403) {
		throw new Error(
			`Gotify rejected the app token (${res.status}). Check it in Gotify under Apps.`
		);
	}
	if (res.status === 404) {
		throw new Error(`No Gotify API at ${target.url} (404). Check the server URL.`);
	}
	throw new Error(`Gotify answered ${res.status}${detail ? `: ${detail}` : ''}`);
}

export const gotifyDriver: ChannelDriver<'gotify'> = {
	label: 'Gotify',

	configFromInput(input, existing) {
		const parsed = parseInput(inputSchema, input);
		const previous = existing === null ? null : stored(existing);
		const token = parsed.token ? encryptSecret(parsed.token) : previous?.token;
		if (!token) throw configError('token', 'Enter the app token');
		return { url: parsed.url, token, priority: parsed.priority } satisfies GotifyStored;
	},

	toPublic(raw): GotifyPublicConfig {
		const s = stored(raw);
		return { url: s.url, priority: s.priority, hasToken: Boolean(s.token) };
	},

	send(raw, message) {
		const s = stored(raw);
		return sendGotify({ url: s.url, token: decryptSecret(s.token), priority: s.priority }, message);
	}
};
