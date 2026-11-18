import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { listPublicMonitors } from '$lib/server/db/repo/monitors.js';
import { getStatusPageSettings } from '$lib/server/db/repo/settings.js';
import { overallStatus } from '$lib/status.js';
import type { RequestHandler } from './$types';

const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=15' };

/** The public status page's data: no sign-in, public monitors only, no targets or messages. */
export const GET: RequestHandler = ({ url }) => {
	const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 90) || 90, 1), 90);
	const db = getDb();
	const monitors = listPublicMonitors(db, days);
	return json(
		{
			page: getStatusPageSettings(db),
			status: overallStatus(monitors.map((m) => m.status)),
			monitors,
			generatedAt: Date.now()
		},
		{ headers: CORS }
	);
};

export const OPTIONS: RequestHandler = () =>
	new Response(null, {
		status: 204,
		headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' }
	});
