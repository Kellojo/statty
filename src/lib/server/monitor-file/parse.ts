// The monitors file: monitors (and optionally the status page) declared in YAML,
// in the same format as kellojo/statty-sync-action, so a file works with both.
//
//   prune: true            # optional: delete monitors removed from the file (default true)
//   statusPage:            # optional
//     title: Acme Status
//     description: …
//   monitors:
//     - name: Website
//       type: http
//       url: https://example.com
//     - name: postgres
//       type: docker
//       container: postgres
//       public: false
//
// `${NAME}` anywhere is replaced with the environment variable NAME (`$${NAME}` is a
// literal `${NAME}`), so secrets can stay out of the file.

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { monitorCreateSchema, type MonitorCreateInput } from '../monitor/input.js';

export interface MonitorFile {
	/** Delete monitors this file declared before but no longer lists. */
	prune: boolean;
	statusPage: { title: string; description: string } | null;
	/** Exactly the fields each entry sets: unset fields are left alone on update. */
	monitors: MonitorCreateInput[];
}

export class MonitorFileError extends Error {}

/** Replaces `${NAME}` in every string with the environment variable NAME. */
export function substituteEnv(
	value: unknown,
	env: Record<string, string | undefined>,
	path = 'file'
): unknown {
	if (typeof value === 'string') {
		return value.replace(/\$?\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
			if (match.startsWith('$$')) return match.slice(1);
			const resolved = env[name];
			if (resolved === undefined) {
				throw new MonitorFileError(
					`${path} uses the environment variable ${name}, which is not set`
				);
			}
			return resolved;
		});
	}
	if (Array.isArray(value)) return value.map((v, i) => substituteEnv(v, env, `${path}[${i}]`));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, substituteEnv(v, env, `${path}.${k}`)])
		);
	}
	return value;
}

const statusPageSchema = z
	.object({
		title: z.string().trim().min(1, 'needs a title').max(100),
		description: z.string().trim().max(1000).default('')
	})
	.strict();

// Strict: a typo such as `interval:` is an error, not a silently ignored field.
const entrySchema = monitorCreateSchema.strict();

function describeIssue(issue: z.core.$ZodIssue): string {
	const where = issue.path.length ? `.${issue.path.join('.')}` : '';
	if (issue.code === 'unrecognized_keys') {
		return `${where} has unknown field${issue.keys.length > 1 ? 's' : ''} ${issue.keys.map((k) => `"${k}"`).join(', ')}`;
	}
	return `${where} ${issue.message}`;
}

/** Parses and validates the file; throws a MonitorFileError listing every problem. */
export function parseMonitorFile(
	raw: string,
	env: Record<string, string | undefined> = process.env
): MonitorFile {
	let doc: unknown;
	try {
		doc = parseYaml(raw) ?? {};
	} catch (e) {
		throw new MonitorFileError(`Not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
		throw new MonitorFileError('The file must be a YAML mapping (e.g. `monitors:` at the top)');
	}
	const data = substituteEnv(doc, env) as Record<string, unknown>;
	const errors: string[] = [];

	for (const key of Object.keys(data)) {
		if (!['monitors', 'statusPage', 'prune'].includes(key)) {
			errors.push(`unknown top-level key "${key}" (use monitors, statusPage or prune)`);
		}
	}

	if (data.prune !== undefined && data.prune !== null && typeof data.prune !== 'boolean') {
		errors.push('prune must be true or false');
	}

	let statusPage: MonitorFile['statusPage'] = null;
	if (data.statusPage !== undefined && data.statusPage !== null) {
		const parsed = statusPageSchema.safeParse(data.statusPage);
		if (parsed.success) statusPage = parsed.data;
		else for (const issue of parsed.error.issues) errors.push(`statusPage${describeIssue(issue)}`);
	}

	const monitors: MonitorCreateInput[] = [];
	// An empty section (`monitors:` followed only by comments) parses as null.
	const list = data.monitors ?? [];
	if (!Array.isArray(list)) {
		errors.push('monitors must be a list');
	} else {
		const seen = new Set<string>();
		list.forEach((entry, i) => {
			const label =
				entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
					? `monitors[${i}] ("${(entry as { name: string }).name}")`
					: `monitors[${i}]`;
			const parsed = entrySchema.safeParse(entry);
			if (!parsed.success) {
				for (const issue of parsed.error.issues) errors.push(`${label}${describeIssue(issue)}`);
				return;
			}
			const m = parsed.data;
			// Monitors are matched by name, ignoring case, so names must be unique that way.
			const key = m.name.toLowerCase();
			if (seen.has(key)) errors.push(`${label}: the name is used twice (names ignore case)`);
			seen.add(key);
			if (m.type === 'http' && !m.url) errors.push(`${label}: an http monitor needs a url`);
			if (m.type === 'docker' && !m.container) {
				errors.push(`${label}: a docker monitor needs a container`);
			}
			if (m.type === 'docker' && m.url) errors.push(`${label}: url only applies to http monitors`);
			if (m.type === 'http' && (m.container || m.dockerHost)) {
				errors.push(`${label}: container and dockerHost only apply to docker monitors`);
			}
			monitors.push(m);
		});
	}

	if (errors.length)
		throw new MonitorFileError(`Invalid monitors file:\n  - ${errors.join('\n  - ')}`);
	return { prune: data.prune !== false, statusPage, monitors };
}
