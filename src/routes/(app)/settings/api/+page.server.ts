import { requireUser } from '$lib/server/auth/guards.js';
import { appOrigin } from '$lib/server/config.js';
import { getDb } from '$lib/server/db/index.js';
import { listApiKeys, toPublic } from '$lib/server/db/repo/api-keys.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const user = requireUser(locals);
	return {
		apiKeys: listApiKeys(getDb(), user.id).map(toPublic),
		origin: appOrigin(url.origin)
	};
};
