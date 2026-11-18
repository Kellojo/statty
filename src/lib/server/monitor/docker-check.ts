import http from 'node:http';
import https from 'node:https';
import type { Monitor } from '$lib/types.js';
import { config } from '../config.js';
import type { CheckOutcome } from '../db/repo/monitors.js';

/** Where a Docker Engine API lives: a local socket / named pipe, or a TCP address. */
export type DockerEndpoint =
	{ kind: 'socket'; socketPath: string } | { kind: 'tcp'; baseUrl: string; tls: boolean };

/**
 * Parses DOCKER_HOST style addresses: unix:///var/run/docker.sock,
 * npipe:////./pipe/docker_engine, tcp://host:2375, http(s)://host:port.
 */
export function parseDockerHost(raw: string): DockerEndpoint {
	const value = raw.trim();
	if (value.startsWith('unix://')) return { kind: 'socket', socketPath: value.slice(7) };
	if (value.startsWith('npipe://')) {
		// npipe:////./pipe/docker_engine -> \\.\pipe\docker_engine
		const pipe = value.slice(8).replace(/\//g, '\\');
		return { kind: 'socket', socketPath: pipe.startsWith('\\\\') ? pipe : `\\\\${pipe}` };
	}
	if (value.startsWith('tcp://')) {
		return { kind: 'tcp', baseUrl: `http://${value.slice(6).replace(/\/+$/, '')}`, tls: false };
	}
	if (/^https?:\/\//.test(value)) {
		return { kind: 'tcp', baseUrl: value.replace(/\/+$/, ''), tls: value.startsWith('https') };
	}
	throw new Error(`Unsupported Docker host: ${value}`);
}

interface DockerResponse {
	status: number;
	body: string;
}

function dockerGet(
	endpoint: DockerEndpoint,
	path: string,
	timeoutMs: number
): Promise<DockerResponse> {
	return new Promise((resolve, reject) => {
		const onResponse = (res: http.IncomingMessage) => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () =>
				resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
			);
			res.on('error', reject);
		};
		const req =
			endpoint.kind === 'socket'
				? http.request(
						{ socketPath: endpoint.socketPath, path, method: 'GET', headers: { host: 'docker' } },
						onResponse
					)
				: (endpoint.tls ? https : http).request(
						`${endpoint.baseUrl}${path}`,
						{ method: 'GET' },
						onResponse
					);
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out after ${timeoutMs / 1000}s`)));
		req.on('error', reject);
		req.end();
	});
}

interface ContainerInspect {
	Name?: string;
	State?: {
		Status?: string;
		Running?: boolean;
		Paused?: boolean;
		Restarting?: boolean;
		ExitCode?: number;
		Health?: { Status?: string; Log?: { Output?: string }[] };
	};
}

/** Turns a container's inspect output into a verdict. */
export function judgeContainer(info: ContainerInspect): Omit<CheckOutcome, 'latencyMs'> {
	const state = info.State ?? {};
	const health = state.Health?.Status;
	if (state.Running && !state.Paused && !state.Restarting) {
		if (!health || health === 'none' || health === 'healthy') {
			return { status: 'up', message: health === 'healthy' ? 'Running (healthy)' : 'Running' };
		}
		if (health === 'starting') return { status: 'pending', message: 'Running (health: starting)' };
		const last = state.Health?.Log?.at(-1)?.Output?.trim();
		return {
			status: 'down',
			message: `Running (unhealthy)${last ? `: ${last.slice(0, 200)}` : ''}`
		};
	}
	if (state.Restarting) return { status: 'down', message: 'Restarting' };
	if (state.Paused) return { status: 'down', message: 'Paused' };
	const exit = state.ExitCode !== undefined ? ` (exit code ${state.ExitCode})` : '';
	return { status: 'down', message: `${capitalize(state.Status ?? 'not running')}${exit}` };
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function checkDocker(monitor: Monitor): Promise<CheckOutcome> {
	const started = performance.now();
	try {
		const endpoint = parseDockerHost(monitor.dockerHost ?? config.DOCKER_HOST);
		const res = await dockerGet(
			endpoint,
			`/containers/${encodeURIComponent(monitor.container!)}/json`,
			monitor.timeoutSeconds * 1000
		);
		const latencyMs = Math.round(performance.now() - started);
		if (res.status === 404) {
			return { status: 'down', latencyMs, message: `Container "${monitor.container}" not found` };
		}
		if (res.status !== 200) {
			let detail = res.body.slice(0, 200);
			try {
				detail = (JSON.parse(res.body) as { message?: string }).message ?? detail;
			} catch {
				// not JSON
			}
			return { status: 'down', latencyMs, message: `Docker API ${res.status}: ${detail}` };
		}
		return { ...judgeContainer(JSON.parse(res.body) as ContainerInspect), latencyMs };
	} catch (e) {
		return {
			status: 'down',
			latencyMs: null,
			message: `Docker API unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}
