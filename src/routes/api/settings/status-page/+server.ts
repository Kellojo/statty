import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { getDb } from '$lib/server/db/index.js';
import { setStatusPageSettings } from '$lib/server/db/repo/settings.js';
import { readBody } from '$lib/server/http.js';
import type { RequestHandler } from './$types';

const schema = z.object({
	title: z.string().trim().min(1, 'Give the page a title').max(100),
	description: z.string().trim().max(1000)
});

export const PUT: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);
	const body = await readBody(request, schema);
	return json({ settings: setStatusPageSettings(getDb(), body) });
};
