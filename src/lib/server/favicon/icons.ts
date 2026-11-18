// Pure helpers for finding a site's icon: reading the icon <link>s of a page's
// <head>, ranking them, and checking that fetched bytes really are an image.
// Adapted from Chatty's favicon cache (src/lib/server/net/favicon.ts there).

/** Icons above this size are refused (a favicon is a few KB; this leaves room for big SVGs). */
export const MAX_ICON_BYTES = 256 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity.startsWith('#')) {
			const hex = entity[1] === 'x' || entity[1] === 'X';
			const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[entity.toLowerCase()] ?? match;
	});
}

/** A tag's attributes, lower-cased names, first one wins. */
function attrs(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
		const name = m[1].toLowerCase();
		if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
	}
	return out;
}

/** `href` resolved against `base`, kept only when it is http(s). */
function absolute(href: string | undefined, base: string): string | null {
	if (!href?.trim()) return null;
	try {
		const u = new URL(href.trim(), base);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
	} catch {
		return null;
	}
}

export interface IconLink {
	href: string;
	kind: 'icon' | 'apple-touch-icon';
	type: string | null;
	/** The largest square size declared, 'any' for scalable, or null if none or not square. */
	size: number | 'any' | null;
	/** Sizes were declared, but none square. */
	nonSquare: boolean;
}

function parseSizes(sizes: string | undefined): Pick<IconLink, 'size' | 'nonSquare'> {
	const tokens = (sizes ?? '').toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.includes('any')) return { size: 'any', nonSquare: false };
	let best: number | null = null;
	let declared = false;
	for (const t of tokens) {
		const m = /^(\d+)x(\d+)$/.exec(t);
		if (!m) continue;
		declared = true;
		if (m[1] === m[2]) best = Math.max(best ?? 0, Number(m[1]));
	}
	return { size: best, nonSquare: declared && best === null };
}

/**
 * The icon links in a page's <head>: rel="icon", "shortcut icon" and
 * "apple-touch-icon(-precomposed)", with hrefs resolved (honouring <base>).
 * mask-icon is skipped: it is a one-colour silhouette.
 */
export function parseIconLinks(html: string, pageUrl: string): IconLink[] {
	const headEnd = /<\/head\s*>|<body\b/i.exec(html)?.index;
	const head = html.slice(0, headEnd ?? html.length).replace(/<!--[\s\S]*?-->/g, '');
	const baseTag = /<base\b[^>]*>/i.exec(head)?.[0];
	const base = (baseTag && absolute(attrs(baseTag).href, pageUrl)) || pageUrl;
	const links: IconLink[] = [];
	for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
		const a = attrs(m[0]);
		const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
		const kind = rel.includes('icon')
			? 'icon'
			: rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')
				? 'apple-touch-icon'
				: null;
		const href = absolute(a.href, base);
		if (!kind || !href) continue;
		links.push({ href, kind, type: a.type?.toLowerCase().trim() || null, ...parseSizes(a.sizes) });
	}
	return links;
}

function isSvg(link: IconLink): boolean {
	return link.type === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(link.href);
}

function isPng(link: IconLink): boolean {
	return link.type === 'image/png' || /\.png(?:[?#]|$)/i.test(link.href);
}

/**
 * Lower is better. Icons show at 16–20px (32–40 device pixels), so:
 * SVG first; then square PNGs of 32px or more, closest to 64px; then other
 * icons of unknown size (often a multi-size .ico); small and non-square last.
 * apple-touch-icons are usually 180px opaque tiles, slightly behind a real favicon.
 */
export function iconScore(link: IconLink): number {
	if (isSvg(link)) return link.kind === 'icon' ? 0 : 0.5;
	const size = link.size === null && link.kind === 'apple-touch-icon' ? 180 : link.size;
	const touch = link.kind === 'apple-touch-icon' ? 0.3 : 0;
	if (link.nonSquare) return 4 + touch;
	if (size === 'any') return 1 + touch;
	if (size !== null && size >= 32) {
		return (
			(isPng(link) || link.kind === 'apple-touch-icon' ? 1 : 1.6) +
			Math.abs(Math.log2(size / 64)) * 0.1 +
			touch
		);
	}
	if (size === null) return 2.5 + touch;
	return 3 + (32 - size) / 32 + touch;
}

/** Icon URLs to try for a page, best first, without duplicates. */
export function rankIcons(links: IconLink[]): string[] {
	const ranked = links
		.map((link, i) => ({ href: link.href, score: iconScore(link), i }))
		.sort((a, b) => a.score - b.score || a.i - b.i);
	return [...new Set(ranked.map((r) => r.href))];
}

/** The image type of `body` from its magic bytes; SVG by its root element. Null if not an image. */
export function sniffImageType(body: Uint8Array): string | null {
	const starts = (...bytes: number[]) => bytes.every((b, i) => body[i] === b);
	const ascii = (from: number, to: number) =>
		Buffer.from(body.subarray(from, to)).toString('latin1');
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
	if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
	if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (starts(0x00, 0x00, 0x01, 0x00) && body.length > 6) return 'image/x-icon';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	if (ascii(4, 12) === 'ftypavif') return 'image/avif';
	// trimStart also drops a byte-order mark (U+FEFF counts as whitespace).
	const head = Buffer.from(body.subarray(0, 2048)).toString('utf8').trimStart();
	if (
		/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)
	) {
		return 'image/svg+xml';
	}
	return null;
}

/** Declared types an icon may come with: images, or the generic types some servers use for .ico. */
function plausibleType(declared: string): boolean {
	return (
		declared === '' ||
		declared.startsWith('image/') ||
		/^(?:application|binary)\/octet-stream$|^text\/plain$|^text\/xml$|^application\/xml$/.test(
			declared
		)
	);
}

/**
 * The content type to store and serve `body` as, or null when it isn't an
 * image within the size cap. The bytes decide (a mislabelled .ico is fine);
 * the declared type only rules out what is clearly something else, e.g. an
 * HTML error page served with 200.
 */
export function validateIcon(declaredType: string | null, body: Uint8Array): string | null {
	if (body.length === 0 || body.length > MAX_ICON_BYTES) return null;
	const declared = (declaredType ?? '').split(';')[0].trim().toLowerCase();
	if (!plausibleType(declared)) return null;
	return sniffImageType(body);
}
