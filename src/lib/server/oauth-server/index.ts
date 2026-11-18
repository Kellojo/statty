// OAuth 2.1 authorization server for the MCP endpoint (/api/mcp), as the MCP
// authorization spec asks of a protected MCP server:
// - protected resource metadata (RFC 9728) points clients at this server;
// - authorization server metadata (RFC 8414) lists the endpoints;
// - dynamic client registration (RFC 7591) for public clients;
// - authorization code + PKCE (S256), refresh tokens that rotate, revocation (RFC 7009).
//
// Users sign in to Statty itself (password or the instance's OIDC provider) and
// approve the client. An approval creates (or, when the same client signs in
// again, updates) an API key with the scopes the user granted. Tokens stand in
// for that key, so it is listed, edited and revoked like any other key.

import { createHash } from 'node:crypto';
import { API_SCOPES, type ApiScope } from '$lib/types.js';
import { appOrigin } from '../config.js';
import type { Db } from '../db/index.js';
import { createApiKey, updateApiKey } from '../db/repo/api-keys.js';
import {
	createAuthorizationCode,
	findOAuthKey,
	getOAuthClient,
	markOAuthClientApproved,
	redirectUris,
	revokeClientTokens,
	type OAuthClientRow
} from '../db/repo/oauth.js';

export const MCP_RESOURCE_PATH = '/api/mcp';

export function issuer(requestOrigin: string): string {
	return appOrigin(requestOrigin);
}

/** The MCP endpoint, as clients name it in `resource`. */
export function resourceUrl(requestOrigin: string): string {
	return `${issuer(requestOrigin)}${MCP_RESOURCE_PATH}`;
}

export function protectedResourceMetadataUrl(requestOrigin: string): string {
	return `${issuer(requestOrigin)}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}

export function protectedResourceMetadata(requestOrigin: string) {
	return {
		resource: resourceUrl(requestOrigin),
		authorization_servers: [issuer(requestOrigin)],
		scopes_supported: [...API_SCOPES],
		bearer_methods_supported: ['header'],
		resource_name: 'Statty'
	};
}

export function authorizationServerMetadata(requestOrigin: string) {
	const base = issuer(requestOrigin);
	return {
		issuer: base,
		authorization_endpoint: `${base}/oauth/authorize`,
		token_endpoint: `${base}/api/oauth/token`,
		registration_endpoint: `${base}/api/oauth/register`,
		revocation_endpoint: `${base}/api/oauth/revoke`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [...API_SCOPES],
		authorization_response_iss_parameter_supported: true
	};
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:']);

/**
 * Whether a client may register this redirect URI: https anywhere, http only on
 * loopback (native apps, RFC 8252), or an app's own custom scheme.
 */
export function isAllowedRedirectUri(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.hash) return false;
	if (url.protocol === 'https:') return true;
	if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
	return !FORBIDDEN_SCHEMES.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

export function verifyPkce(verifier: string, challenge: string): boolean {
	if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
	return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

/** `resource` must name this MCP endpoint when given (RFC 8707); a trailing slash is fine. */
export function isOurResource(resource: string | null, requestOrigin: string): boolean {
	if (!resource) return true;
	return resource.replace(/\/+$/, '') === resourceUrl(requestOrigin);
}

export interface AuthorizeRequest {
	client: OAuthClientRow;
	redirectUri: string;
	codeChallenge: string;
	state: string | null;
	/** The scopes the client asked for (all of them when it named none). */
	scopes: ApiScope[];
}

export type AuthorizeCheck =
	| { ok: true; request: AuthorizeRequest }
	/** Can't safely send the user back to the client: show the error here. */
	| { ok: false; fatal: true; message: string }
	/** Tell the client through its redirect URI. */
	| { ok: false; fatal: false; redirectTo: string };

/** Errors go back to the client the way RFC 6749 §4.1.2.1 says. */
export function errorRedirect(
	redirectUri: string,
	error: string,
	description: string,
	state: string | null,
	requestOrigin: string
): string {
	const url = new URL(redirectUri);
	url.searchParams.set('error', error);
	url.searchParams.set('error_description', description);
	if (state) url.searchParams.set('state', state);
	url.searchParams.set('iss', issuer(requestOrigin));
	return url.toString();
}

/** Checks an authorization request's query, client and redirect URI. */
export function checkAuthorizeRequest(
	db: Db,
	params: URLSearchParams,
	requestOrigin: string
): AuthorizeCheck {
	const clientId = params.get('client_id');
	const client = clientId ? getOAuthClient(db, clientId) : undefined;
	if (!client) {
		return {
			ok: false,
			fatal: true,
			message:
				'This app is not registered with Statty. Remove this connection in your app and add it again.'
		};
	}
	const registered = redirectUris(client);
	const redirectUri = params.get('redirect_uri') ?? (registered.length === 1 ? registered[0] : '');
	if (!redirectUri || !registered.includes(redirectUri)) {
		return {
			ok: false,
			fatal: true,
			message: 'The app asked to return to an address it never registered.'
		};
	}
	const state = params.get('state');
	// Anyone can register a client with any https redirect URI, so bouncing a
	// bad request straight back would make Statty an open redirect (RFC 9700
	// §4.11). Only a client someone already approved gets the error redirect.
	const fail = (error: string, description: string): AuthorizeCheck =>
		client.approved_at
			? {
					ok: false,
					fatal: false,
					redirectTo: errorRedirect(redirectUri, error, description, state, requestOrigin)
				}
			: { ok: false, fatal: true, message: `The app sent an invalid request: ${description}.` };
	if (params.get('response_type') !== 'code') {
		return fail('unsupported_response_type', 'Only the authorization code flow is supported');
	}
	const codeChallenge = params.get('code_challenge');
	if (!codeChallenge || params.get('code_challenge_method') !== 'S256') {
		return fail('invalid_request', 'PKCE with S256 is required');
	}
	if (!isOurResource(params.get('resource'), requestOrigin)) {
		return fail('invalid_target', 'Unknown resource');
	}
	const asked = (params.get('scope') ?? '').split(' ').filter(Boolean);
	if (!asked.every((s) => (API_SCOPES as readonly string[]).includes(s))) {
		return fail('invalid_scope', `Supported scopes: ${API_SCOPES.join(', ')}`);
	}
	const scopes = asked.length ? (asked as ApiScope[]) : [...API_SCOPES];
	return { ok: true, request: { client, redirectUri, codeChallenge, state, scopes } };
}

/**
 * Records the user's approval: their key for this client (made now, or the one
 * from an earlier sign-in, updated) and a code to exchange for tokens. Returns
 * where to send the user's browser.
 */
export async function approveAuthorization(
	db: Db,
	userId: string,
	request: AuthorizeRequest,
	choice: { label: string; scopes: ApiScope[] },
	requestOrigin: string
): Promise<string> {
	// Reading status always comes with access; writes only if the user ticked them.
	const scopes: ApiScope[] = ['status:read', ...choice.scopes.filter((s) => s !== 'status:read')];
	const existing = findOAuthKey(db, userId, request.client.id);
	let keyId: string;
	if (existing) {
		// A fresh sign-in replaces the old session, so tokens that may have leaked die here.
		revokeClientTokens(db, existing.id, request.client.id);
		updateApiKey(db, existing.id, userId, { label: choice.label, scopes });
		keyId = existing.id;
	} else {
		const { row } = await createApiKey(db, {
			userId,
			label: choice.label,
			scopes,
			oauthClientId: request.client.id
		});
		keyId = row.id;
	}
	markOAuthClientApproved(db, request.client.id);
	const code = createAuthorizationCode(db, {
		clientId: request.client.id,
		apiKeyId: keyId,
		redirectUri: request.redirectUri,
		codeChallenge: request.codeChallenge
	});
	const url = new URL(request.redirectUri);
	url.searchParams.set('code', code);
	if (request.state) url.searchParams.set('state', request.state);
	url.searchParams.set('iss', issuer(requestOrigin));
	return url.toString();
}
