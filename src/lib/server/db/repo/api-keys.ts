import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { API_SCOPES, type ApiKey, type ApiScope } from '$lib/types.js';
import type { Db } from '../index.js';

export const API_KEY_PREFIX = 'sty_';

export interface ApiKeyRow {
	id: string;
	user_id: string;
	label: string;
	hash: string;
	scopes: string;
	/** The OAuth client the key was approved for (MCP sign-in); null for keys made by hand. */
	oauth_client_id: string | null;
	/** Joined from oauth_clients by the list query. */
	oauth_client_name?: string | null;
	created_at: number;
	last_used_at: number | null;
}

export function parseScopes(raw: string): ApiScope[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s))
			: [];
	} catch {
		return [];
	}
}

export function toPublic(row: ApiKeyRow): ApiKey {
	return {
		id: row.id,
		label: row.label,
		scopes: parseScopes(row.scopes),
		oauthClient: row.oauth_client_id ? (row.oauth_client_name ?? 'OAuth client') : null,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at
	};
}

export async function createApiKey(
	db: Db,
	input: { userId: string; label: string; scopes: ApiScope[]; oauthClientId?: string | null }
): Promise<{ row: ApiKeyRow; rawKey: string }> {
	const id = randomUUID();
	const rawKey = `${API_KEY_PREFIX}${id}_${randomBytes(24).toString('base64url')}`;
	const keyHash = await hash(rawKey);
	db.prepare(
		`INSERT INTO api_keys (id, user_id, label, hash, scopes, oauth_client_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		input.userId,
		input.label,
		keyHash,
		JSON.stringify(input.scopes),
		input.oauthClientId ?? null,
		Date.now()
	);
	return { row: getApiKey(db, id)!, rawKey };
}

const SELECT_KEY = `SELECT k.*, c.name AS oauth_client_name
	FROM api_keys k LEFT JOIN oauth_clients c ON c.id = k.oauth_client_id`;

export function getApiKey(db: Db, id: string): ApiKeyRow | undefined {
	return db.prepare(`${SELECT_KEY} WHERE k.id = ?`).get(id) as ApiKeyRow | undefined;
}

export function listApiKeys(db: Db, userId: string): ApiKeyRow[] {
	return db
		.prepare(`${SELECT_KEY} WHERE k.user_id = ? ORDER BY k.created_at DESC`)
		.all(userId) as ApiKeyRow[];
}

/** Changes a key's label or scopes; the secret stays the same. */
export function updateApiKey(
	db: Db,
	id: string,
	userId: string,
	input: { label?: string; scopes?: ApiScope[] }
): ApiKeyRow | undefined {
	const row = getApiKey(db, id);
	if (!row || row.user_id !== userId) return undefined;
	db.prepare('UPDATE api_keys SET label = ?, scopes = ? WHERE id = ?').run(
		input.label ?? row.label,
		input.scopes ? JSON.stringify(input.scopes) : row.scopes,
		id
	);
	return getApiKey(db, id);
}

// argon2 is deliberately slow, so successful verifications are cached
// briefly. Keyed by a SHA-256 of the presented key (the plaintext is never
// stored) and only honoured while the row still exists with the same hash.
const VERIFY_CACHE_TTL_MS = 60_000;
const VERIFY_CACHE_MAX = 500;
const verifyCache = new Map<string, { keyId: string; hash: string; expiresAt: number }>();

function digest(rawKey: string): string {
	return createHash('sha256').update(rawKey).digest('hex');
}

function forgetKey(keyId: string): void {
	for (const [k, v] of verifyCache) if (v.keyId === keyId) verifyCache.delete(k);
}

export function deleteApiKey(db: Db, id: string, userId: string): boolean {
	const deleted =
		db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
	if (deleted) forgetKey(id);
	return deleted;
}

export async function resolveApiKey(db: Db, rawKey: string): Promise<ApiKeyRow | null> {
	if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
	const rest = rawKey.slice(API_KEY_PREFIX.length);
	const sep = rest.indexOf('_');
	if (sep <= 0 || sep === rest.length - 1) return null;
	const row = getApiKey(db, rest.slice(0, sep));
	if (!row) return null;
	const cacheKey = digest(rawKey);
	const cached = verifyCache.get(cacheKey);
	const now = Date.now();
	if (!cached || cached.keyId !== row.id || cached.hash !== row.hash || cached.expiresAt <= now) {
		if (cached) verifyCache.delete(cacheKey);
		try {
			if (!(await verify(row.hash, rawKey))) return null;
		} catch {
			return null;
		}
		if (verifyCache.size >= VERIFY_CACHE_MAX) {
			verifyCache.delete(verifyCache.keys().next().value!);
		}
		verifyCache.set(cacheKey, {
			keyId: row.id,
			hash: row.hash,
			expiresAt: now + VERIFY_CACHE_TTL_MS
		});
	}
	db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now, row.id);
	return getApiKey(db, row.id)!;
}
