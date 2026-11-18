import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import {
	approveAuthorization,
	checkAuthorizeRequest,
	errorRedirect
} from '$lib/server/oauth-server/index.js';
import { API_SCOPES } from '$lib/types.js';
import type { RequestHandler } from './$types';

const bodySchema = z.discriminatedUnion('decision', [
	z.object({
		decision: z.literal('approve'),
		/** The query string of the /oauth/authorize page. */
		query: z.string().max(8000),
		label: z.string().trim().min(1).max(100),
		scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length)
	}),
	z.object({ decision: z.literal('deny'), query: z.string().max(8000) })
]);

/**
 * The consent page's answer. JSON from the page itself (a form post couldn't
 * redirect to the client: CSP form-action is 'self'), so it returns where the
 * browser goes next instead of redirecting.
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
	const user = requireUser(locals);
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, { message: parsed.error.issues[0]?.message ?? 'Invalid body' });
	const db = getDb();
	const check = checkAuthorizeRequest(db, new URLSearchParams(parsed.data.query), url.origin);
	if (!check.ok) {
		if (check.fatal) error(400, { message: check.message });
		return json({ redirectTo: check.redirectTo });
	}
	if (parsed.data.decision === 'deny') {
		const { redirectUri, state } = check.request;
		return json({
			redirectTo: errorRedirect(
				redirectUri,
				'access_denied',
				'The user declined',
				state,
				url.origin
			)
		});
	}
	// Never more than the client asked for.
	const scopes = parsed.data.scopes.filter((s) => check.request.scopes.includes(s));
	const redirectTo = await approveAuthorization(
		db,
		user.id,
		check.request,
		{ label: parsed.data.label, scopes },
		url.origin
	);
	return json({ redirectTo });
};
