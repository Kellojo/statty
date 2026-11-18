import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import { createApiKey, listApiKeys, toPublic } from '$lib/server/db/repo/api-keys.js';
import { readBody } from '$lib/server/http.js';
import { API_SCOPES } from '$lib/types.js';
import type { RequestHandler } from './$types';

const createSchema = z.object({
	label: z.string().trim().min(1, 'Name the key').max(100),
	scopes: z.array(z.enum(API_SCOPES)).min(1, 'Pick at least one scope')
});

// Keys are managed from the signed-in app only, never with another key.
export const GET: RequestHandler = ({ locals }) => {
	const user = requireUser(locals);
	return json({ apiKeys: listApiKeys(getDb(), user.id).map(toPublic) });
};

/** Creates a key; the raw key is only ever in this response. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await readBody(request, createSchema);
	const { row, rawKey } = await createApiKey(getDb(), { userId: user.id, ...body });
	return json({ apiKey: toPublic(row), key: rawKey }, { status: 201 });
};
