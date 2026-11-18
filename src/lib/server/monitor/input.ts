import { z } from 'zod';
import { HTTP_METHODS, MONITOR_TYPES } from '$lib/types.js';

const STATUS_LIST = /^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/;

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullish()
		.transform((v) => v || null);

/** Every field a monitor can be given; create and update narrow it. */
const fields = z.object({
	name: z.string().trim().min(1, 'Name is required').max(100),
	description: optionalText(500),
	type: z.enum(MONITOR_TYPES),
	url: optionalText(2000).refine(
		(v) => v === null || /^https?:\/\//i.test(v),
		'URL must start with http:// or https://'
	),
	method: z.enum(HTTP_METHODS),
	acceptedStatuses: z.string().trim().regex(STATUS_LIST, 'Use codes and ranges, e.g. 200-299,301'),
	keyword: optionalText(500),
	ignoreTls: z.boolean(),
	container: optionalText(255),
	dockerHost: optionalText(500).refine(
		(v) => v === null || /^(unix|npipe|tcp|http|https):\/\//i.test(v),
		'Docker host must start with unix://, npipe://, tcp://, http:// or https://'
	),
	intervalSeconds: z.number().int().min(10).max(86_400),
	timeoutSeconds: z.number().int().min(1).max(300),
	retries: z.number().int().min(0).max(20),
	enabled: z.boolean(),
	public: z.boolean(),
	sortOrder: z.number().int().min(-1_000_000).max(1_000_000)
});

export type MonitorFields = z.infer<typeof fields>;

export const DEFAULTS: Omit<MonitorFields, 'name' | 'type'> = {
	description: null,
	url: null,
	method: 'GET',
	acceptedStatuses: '200-299',
	keyword: null,
	ignoreTls: false,
	container: null,
	dockerHost: null,
	intervalSeconds: 60,
	timeoutSeconds: 10,
	retries: 0,
	enabled: true,
	public: true,
	sortOrder: 0
};

export const monitorCreateSchema = fields.partial().required({ name: true, type: true });
export const monitorUpdateSchema = fields.partial();

export type MonitorCreateInput = z.infer<typeof monitorCreateSchema>;
export type MonitorUpdateInput = z.infer<typeof monitorUpdateSchema>;

/** What is wrong with a monitor's merged fields, or null: a missing target, or a timeout past the interval. */
export function fieldsProblem(
	m: Pick<MonitorFields, 'type' | 'url' | 'container' | 'timeoutSeconds' | 'intervalSeconds'>
): string | null {
	if (m.type === 'http' && !m.url) return 'url: An HTTP monitor needs a URL';
	if (m.type === 'docker' && !m.container) {
		return 'container: A Docker monitor needs a container name or id';
	}
	if (m.timeoutSeconds > m.intervalSeconds) {
		return 'timeoutSeconds: The timeout cannot be longer than the interval';
	}
	return null;
}

/** Parses "200-299,301" into ranges; the input is already validated. */
export function parseStatusRanges(list: string): [number, number][] {
	return list
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const [from, to] = part.split('-').map((n) => Number(n.trim()));
			return [from, to ?? from] as [number, number];
		});
}

export function isAcceptedStatus(code: number, list: string): boolean {
	return parseStatusRanges(list).some(([from, to]) => code >= from && code <= to);
}
