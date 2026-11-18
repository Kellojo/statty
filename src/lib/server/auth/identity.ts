import { error, type RequestEvent } from '@sveltejs/kit';
import { API_SCOPES, type ApiScope } from '$lib/types.js';
import { getDb, type Db } from '../db/index.js';
import { parseScopes, resolveApiKey, type ApiKeyRow } from '../db/repo/api-keys.js';
import { isOAuthAccessToken, resolveAccessToken } from '../db/repo/oauth.js';

/** Who is calling the API: a signed-in browser, an API key, or an MCP client's OAuth token. */
export interface Identity {
	userId: string;
	role: string;
	scopes: ApiScope[];
	via: 'session' | 'api-key' | 'oauth';
	keyId: string | null;
}

function fromKeyRow(db: Db, row: ApiKeyRow, via: Identity['via']): Identity {
	const user = db.prepare('SELECT role FROM "user" WHERE id = ?').get(row.user_id) as
		{ role: string } | undefined;
	return {
		userId: row.user_id,
		role: user?.role ?? 'user',
		scopes: parseScopes(row.scopes),
		via,
		keyId: row.id
	};
}

/** The identity behind an `Authorization: Bearer` API key or OAuth access token. */
export async function identityFromBearer(
	db: Db,
	authorization: string | null
): Promise<Identity | null> {
	if (!authorization?.startsWith('Bearer ')) return null;
	const token = authorization.slice('Bearer '.length).trim();
	if (isOAuthAccessToken(token)) {
		const row = resolveAccessToken(db, token);
		return row ? fromKeyRow(db, row, 'oauth') : null;
	}
	const row = await resolveApiKey(db, token);
	return row ? fromKeyRow(db, row, 'api-key') : null;
}

/** The caller of an API route: a bearer token first, else the browser session (all scopes). */
export async function identify(event: RequestEvent): Promise<Identity | null> {
	const bearer = await identityFromBearer(getDb(), event.request.headers.get('authorization'));
	if (bearer) return bearer;
	const user = event.locals.user;
	if (!user) return null;
	return {
		userId: user.id,
		role: (user as { role?: string }).role ?? 'user',
		scopes: [...API_SCOPES],
		via: 'session',
		keyId: null
	};
}

/** The caller, if it may use `scope`; a 401 or 403 otherwise. */
export async function requireScope(event: RequestEvent, scope: ApiScope): Promise<Identity> {
	const identity = await identify(event);
	if (!identity) error(401, { message: 'Sign in or pass an API key as a Bearer token' });
	if (!identity.scopes.includes(scope)) {
		error(403, { message: `This key is missing the '${scope}' scope` });
	}
	return identity;
}
