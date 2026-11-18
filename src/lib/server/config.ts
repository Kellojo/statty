import { z } from 'zod';

const boolFromString = (fallback: 'true' | 'false') =>
	z
		.enum(['true', 'false'])
		.default(fallback)
		.transform((v) => v === 'true');

const defaultDockerHost =
	process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';

const schema = z.object({
	DATABASE_PATH: z.string().default('./data/statty.db'),
	ENABLE_SIGNUP: boolFromString('true'),
	ENABLE_PASSWORD_LOGIN: boolFromString('true'),
	OIDC_ONLY: boolFromString('false'),
	OIDC_ISSUER: z.string().url().optional(),
	OIDC_CLIENT_ID: z.string().optional(),
	OIDC_CLIENT_SECRET: z.string().optional(),
	OIDC_SCOPES: z.string().default('openid profile email'),
	AUTO_PROMOTE_FIRST_USER: boolFromString('true'),
	ORIGIN: z.string().url().optional(),
	APP_SECRET: z.string().min(16).optional(),
	// The Docker Engine API for docker monitors (a monitor can name its own host).
	DOCKER_HOST: z.string().default(defaultDockerHost),
	HEARTBEAT_RETENTION_DAYS: z.coerce.number().int().min(1).default(90)
});

export type Config = z.infer<typeof schema>;

function load(): Config {
	const parsed = schema.safeParse(process.env);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
		throw new Error(`Invalid environment configuration: ${issues}`);
	}
	const c = parsed.data;
	if (c.OIDC_ONLY && (!c.OIDC_ISSUER || !c.OIDC_CLIENT_ID || !c.OIDC_CLIENT_SECRET)) {
		throw new Error('OIDC_ONLY=true requires OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET');
	}
	return c;
}

export const config = load();

/** Statty's public origin: ORIGIN when set, else the request's own. */
export function appOrigin(requestOrigin: string): string {
	return (config.ORIGIN ?? requestOrigin).replace(/\/+$/, '');
}
