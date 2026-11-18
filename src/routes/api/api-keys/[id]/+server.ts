import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import { deleteApiKey, toPublic, updateApiKey } from '$lib/server/db/repo/api-keys.js';
import { readBody } from '$lib/server/http.js';
import { API_SCOPES } from '$lib/types.js';
import type { RequestHandler } from './$types';

const updateSchema = z
	.object({
		label: z.string().trim().min(1, 'Name the key').max(100),
		scopes: z.array(z.enum(API_SCOPES)).min(1, 'Pick at least one scope')
	})
	.partial();

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireUser(locals);
	const body = await readBody(request, updateSchema);
	const row = updateApiKey(getDb(), params.id, user.id, body);
	if (!row) error(404, { message: 'API key not found' });
	return json({ apiKey: toPublic(row) });
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const user = requireUser(locals);
	if (!deleteApiKey(getDb(), params.id, user.id)) error(404, { message: 'API key not found' });
	return json({ ok: true });
};
