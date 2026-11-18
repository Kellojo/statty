// Finds a site's icon over the network: the icons its home page declares,
// best first, then /favicon.ico. Every request has a timeout and a size cap.

import { Agent, fetch } from 'undici';
import { MAX_ICON_BYTES, parseIconLinks, rankIcons, validateIcon } from './icons.js';

/** Only the start of the home page is read; icon links live in its <head>. */
const MAX_PAGE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
/** The whole search for one origin. */
const SEARCH_TIMEOUT_MS = 20_000;
/** Icon URLs tried per origin, so a page listing dozens can't keep us busy. */
const MAX_ATTEMPTS = 6;

const USER_AGENT = 'Statty/1.0 (uptime monitor; favicon)';
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface FoundIcon {
	contentType: string;
	body: Buffer;
}

interface Options {
	/** As the monitor's own setting: accept self-signed and otherwise invalid certificates. */
	ignoreTls?: boolean;
	signal?: AbortSignal;
}

/** Reads at most `max` bytes; `truncated` when the body was longer. */
async function readLimited(
	body: AsyncIterable<Uint8Array> | null,
	max: number
): Promise<{ bytes: Buffer; truncated: boolean }> {
	if (!body) return { bytes: Buffer.alloc(0), truncated: false };
	const chunks: Uint8Array[] = [];
	let size = 0;
	// Leaving the loop early cancels the rest of the stream.
	for await (const chunk of body) {
		chunks.push(chunk);
		size += chunk.byteLength;
		if (size > max) return { bytes: Buffer.concat(chunks).subarray(0, max), truncated: true };
	}
	return { bytes: Buffer.concat(chunks), truncated: false };
}

function get(url: string, accept: string, opts: Options) {
	return fetch(url, {
		redirect: 'follow',
		headers: { accept, 'user-agent': USER_AGENT },
		signal: AbortSignal.any([
			AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			...(opts.signal ? [opts.signal] : [])
		]),
		...(opts.ignoreTls ? { dispatcher: insecureAgent } : {})
	});
}

/** The start of the origin's home page and the URL it ended up at, or null. */
async function fetchHomePage(
	origin: string,
	opts: Options
): Promise<{ html: string; url: string } | null> {
	try {
		const res = await get(`${origin}/`, 'text/html,application/xhtml+xml', opts);
		const type = res.headers.get('content-type') ?? '';
		if (!res.ok || (type && !/html|xml/i.test(type))) {
			await res.body?.cancel().catch(() => undefined);
			return null;
		}
		const { bytes } = await readLimited(res.body, MAX_PAGE_BYTES);
		return { html: bytes.toString('utf8'), url: res.url || `${origin}/` };
	} catch {
		return null;
	}
}

/** One icon URL, if it answers with an image within the size cap. */
export async function fetchIcon(url: string, opts: Options = {}): Promise<FoundIcon | null> {
	try {
		const res = await get(url, 'image/svg+xml,image/png,image/*;q=0.9,*/*;q=0.5', opts);
		if (!res.ok) {
			await res.body?.cancel().catch(() => undefined);
			return null;
		}
		const declared = res.headers.get('content-type');
		const length = Number(res.headers.get('content-length'));
		if (length > MAX_ICON_BYTES) {
			await res.body?.cancel().catch(() => undefined);
			return null;
		}
		const { bytes, truncated } = await readLimited(res.body, MAX_ICON_BYTES);
		if (truncated) return null;
		const contentType = validateIcon(declared, bytes);
		return contentType ? { contentType, body: bytes } : null;
	} catch {
		return null;
	}
}

/** The best icon `origin` offers, or null when it has none (or can't be reached). */
export async function findFavicon(origin: string, opts: Options = {}): Promise<FoundIcon | null> {
	const signal = AbortSignal.any([
		AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		...(opts.signal ? [opts.signal] : [])
	]);
	const page = await fetchHomePage(origin, { ...opts, signal });
	const candidates = [
		...(page ? rankIcons(parseIconLinks(page.html, page.url)) : []).slice(0, MAX_ATTEMPTS - 1),
		`${origin}/favicon.ico`
	];
	for (const url of new Set(candidates)) {
		if (signal.aborted) break;
		const icon = await fetchIcon(url, { ...opts, signal });
		if (icon) return icon;
	}
	return null;
}
