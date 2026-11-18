import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { parseScopes } from '$lib/server/db/repo/api-keys.js';
import { findOAuthKey } from '$lib/server/db/repo/oauth.js';
import { checkAuthorizeRequest } from '$lib/server/oauth-server/index.js';
import type { PageServerLoad } from './$types';

// The OAuth authorization endpoint: an MCP client (e.g. Claude Code) sends the
// user here to approve it. Signing in uses Statty's own login (password or OIDC).
// The answer goes through /api/oauth/authorize.
export const load: PageServerLoad = ({ locals, url }) => {
	const db = getDb();
	const check = checkAuthorizeRequest(db, url.searchParams, url.origin);
	if (!check.ok) {
		if (check.fatal) return { problem: check.message };
		redirect(303, check.redirectTo);
	}
	if (!locals.user) {
		redirect(302, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	const { client, redirectUri, scopes } = check.request;
	const existing = findOAuthKey(db, locals.user.id, client.id);
	const target = new URL(redirectUri);
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
	return {
		problem: null,
		query: url.searchParams.toString(),
		client: {
			name: client.name,
			// A remote site shows its full origin: the scheme is part of what to trust.
			returnTo: (local ? target.host : target.origin) || redirectUri,
			/** Returns to this machine (loopback): a local CLI such as Claude Code. */
			local
		},
		/** Whether the client asked for write access at all. */
		writeRequested: scopes.includes('monitors:write'),
		user: { name: locals.user.name, email: locals.user.email },
		existing: existing
			? { label: existing.label, canWrite: parseScopes(existing.scopes).includes('monitors:write') }
			: null
	};
};
