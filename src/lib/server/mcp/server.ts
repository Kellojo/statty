// Statty's MCP server, over stateless Streamable HTTP at /api/mcp. Every POST
// gets a fresh server and transport. Read tools need the `status:read` scope;
// the tools that change monitors are only listed for keys with `monitors:write`.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ApiScope, Monitor, MonitorSummary } from '$lib/types.js';
import type { Identity } from '../auth/identity.js';
import { getDb } from '../db/index.js';
import {
	findMonitor,
	getMonitorSummary,
	heartbeatsSince,
	listMonitorSummaries,
	MonitorInputError,
	statusChanges
} from '../db/repo/monitors.js';
import { monitorCreateSchema, monitorUpdateSchema } from '../monitor/input.js';
import { addMonitor, checkNow, editMonitor, removeMonitor } from '../monitor/service.js';
import { createLogger } from '../logger.js';

const log = createLogger('mcp');

const INSTRUCTIONS =
	'Statty is a self-hosted uptime monitor. Each monitor checks a URL (http) or a Docker ' +
	"container's state (docker) on an interval. Use list_monitors for an overview; monitors are " +
	'named by id or exact name.';

class ToolError extends Error {}

/** What tools show of a monitor: its config, state and uptime, without the bar's raw checks. */
function describe(m: Monitor | MonitorSummary) {
	const { recent: _recent, ...rest } = m as MonitorSummary;
	void _recent;
	return {
		...rest,
		target: m.type === 'http' ? `${m.method} ${m.url}` : `container ${m.container}`
	};
}

function resolveMonitor(ref: unknown): Monitor {
	if (typeof ref !== 'string' || !ref.trim()) throw new ToolError('Name a monitor by id or name');
	const monitor = findMonitor(getDb(), ref.trim());
	if (!monitor) throw new ToolError(`No monitor matches "${ref}". Use list_monitors to see them.`);
	return monitor;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new ToolError(`${issue?.path.join('.') || 'input'}: ${issue?.message ?? 'invalid'}`);
	}
	return parsed.data;
}

interface ToolDef {
	scope: ApiScope;
	tool: Tool;
	run: (args: Record<string, unknown>, identity: Identity) => Promise<unknown>;
}

const inputSchema = (schema: z.ZodType) =>
	z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Tool['inputSchema'];

const monitorRef = {
	monitor: { type: 'string', description: 'The monitor id, or its exact name' }
};

const createSchema = monitorCreateSchema;
const updateSchema = monitorUpdateSchema.extend({
	monitor: z.string().describe('The monitor id, or its exact name')
});

const TOOLS: ToolDef[] = [
	{
		scope: 'status:read',
		tool: {
			name: 'list_monitors',
			description:
				'Lists all monitors with their current status (up, down, pending, unknown, paused), last ' +
				'check message, latency and uptime over 24h / 7d / 30d. Optionally filter by status.',
			inputSchema: {
				type: 'object',
				properties: {
					status: {
						type: 'string',
						enum: ['up', 'down', 'pending', 'unknown', 'paused'],
						description: 'Only monitors with this status'
					}
				}
			},
			annotations: { readOnlyHint: true }
		},
		run: async (args) => {
			const all = listMonitorSummaries(getDb(), 0);
			const filtered = args.status ? all.filter((m) => m.status === args.status) : all;
			const counts = all.reduce<Record<string, number>>((acc, m) => {
				acc[m.status] = (acc[m.status] ?? 0) + 1;
				return acc;
			}, {});
			return { total: all.length, counts, monitors: filtered.map(describe) };
		}
	},
	{
		scope: 'status:read',
		tool: {
			name: 'get_monitor',
			description:
				'One monitor in detail: its configuration, current status, uptime, recent status ' +
				'changes (incidents) and the checks of the last hours.',
			inputSchema: {
				type: 'object',
				properties: {
					...monitorRef,
					hours: {
						type: 'number',
						description: 'How many hours of checks to include (default 1, max 168)'
					}
				},
				required: ['monitor']
			},
			annotations: { readOnlyHint: true }
		},
		run: async (args) => {
			const m = resolveMonitor(args.monitor);
			const hours = Math.min(Math.max(Number(args.hours) || 1, 0), 168);
			const db = getDb();
			return {
				monitor: describe(getMonitorSummary(db, m.id, 0)!),
				statusChanges: statusChanges(db, m.id, 20),
				checks: heartbeatsSince(db, m.id, Date.now() - hours * 3_600_000, 500)
			};
		}
	},
	{
		scope: 'monitors:write',
		tool: {
			name: 'create_monitor',
			description:
				'Creates a monitor. type "http" needs `url` (checks status code, optional keyword); ' +
				'type "docker" needs `container` (name or id; up when running and healthy). It is ' +
				'checked right away.',
			inputSchema: inputSchema(createSchema)
		},
		run: async (args, identity) => {
			const input = parse(createSchema, args);
			return { monitor: describe(await addMonitor(input, identity.userId)) };
		}
	},
	{
		scope: 'monitors:write',
		tool: {
			name: 'update_monitor',
			description:
				'Changes a monitor. Pass only the fields to change. Set enabled=false to pause it, ' +
				'public=false to hide it from the public status page.',
			inputSchema: inputSchema(updateSchema)
		},
		run: async (args) => {
			const { monitor: ref, ...input } = parse(updateSchema, args);
			const m = resolveMonitor(ref);
			const updated = await editMonitor(m.id, input);
			if (!updated) throw new ToolError('The monitor was deleted');
			return { monitor: describe(updated) };
		}
	},
	{
		scope: 'monitors:write',
		tool: {
			name: 'delete_monitor',
			description: 'Deletes a monitor and its history. This cannot be undone.',
			inputSchema: { type: 'object', properties: monitorRef, required: ['monitor'] },
			annotations: { destructiveHint: true }
		},
		run: async (args) => {
			const m = resolveMonitor(args.monitor);
			removeMonitor(m.id);
			return { deleted: { id: m.id, name: m.name } };
		}
	},
	{
		scope: 'monitors:write',
		tool: {
			name: 'check_monitor',
			description: 'Runs a check of a monitor now and returns the result.',
			inputSchema: { type: 'object', properties: monitorRef, required: ['monitor'] }
		},
		run: async (args) => {
			const m = resolveMonitor(args.monitor);
			const result = await checkNow(m.id);
			if (!result) throw new ToolError('The monitor is paused; enable it first');
			return { monitor: describe(result) };
		}
	}
];

function asResult(value: unknown): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function createServer(identity: Identity): Server {
	const allowed = TOOLS.filter((t) => identity.scopes.includes(t.scope));
	const server = new Server(
		{ name: 'statty', version: '1.0.0' },
		{ capabilities: { tools: {} }, instructions: INSTRUCTIONS }
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: allowed.map((t) => t.tool)
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		const def = allowed.find((t) => t.tool.name === name);
		if (!def) {
			const known = TOOLS.some((t) => t.tool.name === name);
			return {
				content: [
					{
						type: 'text',
						text: known
							? `${name} needs the '${TOOLS.find((t) => t.tool.name === name)!.scope}' scope`
							: `Unknown tool: ${name}`
					}
				],
				isError: true
			};
		}
		try {
			return asResult(await def.run(args ?? {}, identity));
		} catch (e) {
			if (!(e instanceof ToolError || e instanceof MonitorInputError)) {
				log.warn('Tool call failed', { tool: name, error: String(e) });
			}
			return {
				content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
				isError: true
			};
		}
	});
	return server;
}

/** Answers one MCP request (a JSON-RPC message or batch). */
export async function handleMcpRequest(request: Request, identity: Identity): Promise<Response> {
	const server = createServer(identity);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	try {
		await server.connect(transport);
		return await transport.handleRequest(request);
	} finally {
		await server.close().catch(() => undefined);
	}
}
