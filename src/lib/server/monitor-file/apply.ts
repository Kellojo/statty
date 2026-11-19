// Applies a parsed monitors file: creates the monitors it lists, updates the fields it
// sets (fields it leaves out are not touched), and deletes monitors it declared before
// but no longer lists. Monitors made in the UI or API are only touched when the file
// names them, and then they become file-managed.

import type { Monitor } from '$lib/types.js';
import { getDb } from '../db/index.js';
import {
	findMonitor,
	listConfigManaged,
	MonitorInputError,
	setConfigManaged
} from '../db/repo/monitors.js';
import { getStatusPageSettings, setStatusPageSettings } from '../db/repo/settings.js';
import type { MonitorCreateInput } from '../monitor/input.js';
import { addMonitor, editMonitor, removeMonitor } from '../monitor/service.js';
import type { MonitorFile } from './parse.js';

export interface ApplyResult {
	created: string[];
	updated: string[];
	unchanged: string[];
	deleted: string[];
	failed: { name: string; error: string }[];
	statusPage: 'updated' | 'unchanged' | 'not set';
}

/** The fields of `wanted` whose value differs from the monitor's. */
export function changedFields(
	monitor: Monitor,
	wanted: MonitorCreateInput
): Partial<MonitorCreateInput> {
	const diff: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(wanted)) {
		if (value === undefined) continue;
		const current = (monitor as unknown as Record<string, unknown>)[key];
		// Names match ignoring case, so a case-only rename still counts as a change.
		if (current !== value) diff[key] = value;
	}
	return diff as Partial<MonitorCreateInput>;
}

export async function applyMonitorFile(file: MonitorFile): Promise<ApplyResult> {
	const db = getDb();
	const result: ApplyResult = {
		created: [],
		updated: [],
		unchanged: [],
		deleted: [],
		failed: [],
		statusPage: 'not set'
	};
	const declared = new Set<string>();

	for (const wanted of file.monitors) {
		try {
			const existing = findMonitor(db, wanted.name);
			if (!existing) {
				const created = await addMonitor(wanted, null, { waitForCheck: false });
				setConfigManaged(db, [created.id], true);
				declared.add(created.id);
				result.created.push(created.name);
				continue;
			}
			declared.add(existing.id);
			if (!existing.managedByConfig) setConfigManaged(db, [existing.id], true);
			const diff = changedFields(existing, wanted);
			if (Object.keys(diff).length === 0) {
				result.unchanged.push(existing.name);
				continue;
			}
			await editMonitor(existing.id, diff, { waitForCheck: false });
			result.updated.push(wanted.name);
		} catch (e) {
			const error = e instanceof MonitorInputError || e instanceof Error ? e.message : String(e);
			result.failed.push({ name: wanted.name, error });
		}
	}

	// Only monitors the file itself declared before are pruned; a failed entry keeps its monitor.
	const keep = new Set(result.failed.map((f) => f.name.toLowerCase()));
	for (const managed of listConfigManaged(db)) {
		if (declared.has(managed.id) || keep.has(managed.name.toLowerCase())) continue;
		if (file.prune) {
			removeMonitor(managed.id);
			result.deleted.push(managed.name);
		} else {
			// Without prune, a monitor removed from the file goes back to being managed in the UI.
			setConfigManaged(db, [managed.id], false);
		}
	}

	if (file.statusPage) {
		const current = getStatusPageSettings(db);
		if (
			current.title !== file.statusPage.title ||
			current.description !== file.statusPage.description
		) {
			setStatusPageSettings(db, file.statusPage);
			result.statusPage = 'updated';
		} else {
			result.statusPage = 'unchanged';
		}
	}
	return result;
}
