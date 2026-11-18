import { requireAdmin } from '$lib/server/auth/guards.js';
import { passwordLoginEnabled } from '$lib/server/auth/users.js';
import { getDb } from '$lib/server/db/index.js';
import { listUsers } from '$lib/server/db/repo/users.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return { users: listUsers(getDb()), passwordLogin: passwordLoginEnabled() };
};
