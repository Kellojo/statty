import { error } from '@sveltejs/kit';
import type { z } from 'zod';
import { MonitorInputError } from './db/repo/monitors.js';
import { NotificationInputError } from './notifications/driver.js';

/** The request's JSON body, validated; a 400 naming the first problem otherwise. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
		error(400, { message: `${where}${issue?.message ?? 'Invalid body'}` });
	}
	return parsed.data;
}

/** Runs a monitor or notification channel change, turning input problems into 400s. */
export async function asBadRequest<T>(fn: () => Promise<T> | T): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof MonitorInputError || e instanceof NotificationInputError)
			error(400, { message: e.message });
		throw e;
	}
}
