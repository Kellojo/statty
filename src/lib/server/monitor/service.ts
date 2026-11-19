// Monitor changes as the API, the dashboard and MCP make them: validated, and
// checked right away so the new state shows without waiting an interval.

import type { MonitorSummary } from '$lib/types.js';
import { getDb } from '../db/index.js';
import { publishChange } from '../events.js';
import {
	createMonitor,
	deleteMonitor,
	getMonitor,
	getMonitorSummary,
	updateMonitor
} from '../db/repo/monitors.js';
import { ensureFavicon } from '../favicon/service.js';
import type { MonitorCreateInput, MonitorUpdateInput } from './input.js';
import { checkMonitor } from './scheduler.js';

/** How long a create or update waits for its first check before answering anyway. */
const FIRST_CHECK_WAIT_MS = 3_000;

async function checkBriefly(id: string): Promise<void> {
	await Promise.race([
		checkMonitor(id),
		new Promise((resolve) => setTimeout(resolve, FIRST_CHECK_WAIT_MS))
	]);
}

/** `waitForCheck: false` returns at once; the scheduler checks the monitor on its next tick. */
interface ChangeOptions {
	waitForCheck?: boolean;
}

export async function addMonitor(
	input: MonitorCreateInput,
	userId: string | null,
	{ waitForCheck = true }: ChangeOptions = {}
): Promise<MonitorSummary> {
	const monitor = createMonitor(getDb(), input, userId);
	publishChange(monitor.id);
	ensureFavicon(monitor);
	if (monitor.enabled && waitForCheck) await checkBriefly(monitor.id);
	return getMonitorSummary(getDb(), monitor.id)!;
}

export async function editMonitor(
	id: string,
	input: MonitorUpdateInput,
	{ waitForCheck = true }: ChangeOptions = {}
): Promise<MonitorSummary | undefined> {
	const before = getMonitor(getDb(), id);
	const monitor = updateMonitor(getDb(), id, input);
	if (!monitor) return undefined;
	publishChange(id);
	if (monitor.url !== before?.url || monitor.type !== before?.type) ensureFavicon(monitor);
	if (monitor.enabled && monitor.lastCheckedAt === null && waitForCheck) await checkBriefly(id);
	return getMonitorSummary(getDb(), id);
}

export function removeMonitor(id: string): boolean {
	const deleted = deleteMonitor(getDb(), id);
	if (deleted) publishChange(id, true);
	return deleted;
}

/** Runs a check now; undefined if the monitor is gone or paused. */
export async function checkNow(id: string): Promise<MonitorSummary | undefined> {
	const outcome = await checkMonitor(id);
	if (!outcome) return undefined;
	return getMonitorSummary(getDb(), id);
}
