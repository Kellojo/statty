import { identityFromBearer } from '$lib/server/auth/identity.js';
import { getDb } from '$lib/server/db/index.js';
import { handleMcpRequest } from '$lib/server/mcp/server.js';
import { protectedResourceMetadataUrl } from '$lib/server/oauth-server/index.js';
import { CORS_HEADERS, preflight } from '$lib/server/oauth-server/http.js';
import type { RequestHandler } from './$types';

/** A JSON-RPC error with no request id, as MCP clients expect from the transport. */
function rpcError(status: number, message: string, headers: Record<string, string> = {}) {
	return new Response(
		JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }),
		{ status, headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...headers } }
	);
}

// The MCP server (see $lib/server/mcp/server.ts). Stateless Streamable HTTP:
// only POST is served; there is no session to stream from (GET) or end (DELETE).
// Signs in with OAuth (Statty's own sign-in: password or OIDC) or takes an API key.
export const POST: RequestHandler = async ({ request, url }) => {
	const identity = await identityFromBearer(getDb(), request.headers.get('authorization'));
	if (!identity) {
		// Points OAuth-capable clients (Claude Code, Claude.ai…) at the sign-in (RFC 9728).
		return rpcError(401, 'Sign in or pass an API key', {
			'www-authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(url.origin)}"`
		});
	}
	if (!identity.scopes.includes('status:read')) {
		return rpcError(403, "API key is missing the 'status:read' scope", {
			'www-authenticate': `Bearer error="insufficient_scope", scope="status:read"`
		});
	}
	const response = await handleMcpRequest(request, identity);
	for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
	return response;
};

const notAllowed: RequestHandler = () =>
	rpcError(405, 'Method not allowed: this MCP server is stateless', { allow: 'POST' });

export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS: RequestHandler = () => preflight();
