import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) {
		// Visitors to the dashboard's front door see the public page; deeper links ask to sign in.
		if (url.pathname === '/') redirect(302, '/status');
		redirect(302, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	const { id, name, email, image } = locals.user;
	return {
		user: { id, name, email, image, role: (locals.user as { role?: string }).role ?? 'user' }
	};
};
