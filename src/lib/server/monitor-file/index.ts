// Loads MONITORS_FILE on startup and again whenever its contents change.
//
// Changes are found by polling (MONITORS_FILE_POLL_SECONDS) rather than fs.watch, which
// misses edits on many Docker bind mounts and network shares. Mount the file's
// directory rather than the file itself: a single-file bind mount keeps pointing at the
// old file when an editor or deploy script replaces it.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { applyMonitorFile, type ApplyResult } from './apply.js';
import { parseMonitorFile } from './parse.js';

const log = createLogger('monitors-file');

interface State {
	lastHash: string | null;
	timer: NodeJS.Timeout | null;
	running: Promise<void> | null;
}

const state = ((globalThis as { __stattyMonitorFile?: State }).__stattyMonitorFile ??= {
	lastHash: null,
	timer: null,
	running: null
});

function summary(r: ApplyResult): string {
	const parts = [
		`${r.created.length} created`,
		`${r.updated.length} updated`,
		`${r.unchanged.length} unchanged`,
		`${r.deleted.length} deleted`
	];
	if (r.failed.length) parts.push(`${r.failed.length} failed`);
	return parts.join(', ');
}

/** Reads the file and applies it if it changed since the last apply. */
export async function syncMonitorFile(path: string, force = false): Promise<void> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (e) {
		// Keep polling: the file may appear later (e.g. a volume mounted after start).
		if (state.lastHash !== 'missing') {
			log.error(`Can't read the monitors file ${path}`, { error: String(e) });
			state.lastHash = 'missing';
		}
		return;
	}
	const hash = createHash('sha256').update(raw).digest('hex');
	if (!force && hash === state.lastHash) return;
	state.lastHash = hash;

	let file;
	try {
		file = parseMonitorFile(raw);
	} catch (e) {
		// Nothing is applied from a broken file, so a typo can't delete monitors.
		log.error(`The monitors file ${path} was not applied`, {
			error: e instanceof Error ? e.message : String(e)
		});
		return;
	}
	const result = await applyMonitorFile(file);
	log.info(`Applied ${path}: ${summary(result)}`, {
		created: result.created,
		updated: result.updated,
		deleted: result.deleted,
		...(result.statusPage !== 'not set' ? { statusPage: result.statusPage } : {})
	});
	for (const f of result.failed)
		log.error(`Monitor "${f.name}" from ${path} failed`, { error: f.error });
}

/** Applies MONITORS_FILE now and keeps watching it; does nothing when it isn't set. */
export function startMonitorFile(): void {
	const path = config.MONITORS_FILE;
	if (!path || state.timer || state.running) return;
	const run = () => {
		state.running ??= syncMonitorFile(path)
			.catch((e) => log.error('Applying the monitors file failed', { error: String(e) }))
			.finally(() => (state.running = null));
		return state.running;
	};
	void run();
	if (config.MONITORS_FILE_POLL_SECONDS > 0) {
		state.timer = setInterval(run, config.MONITORS_FILE_POLL_SECONDS * 1000);
		state.timer.unref();
	}
	log.info(
		`Watching ${path}${config.MONITORS_FILE_POLL_SECONDS > 0 ? ` every ${config.MONITORS_FILE_POLL_SECONDS}s` : ' (startup only)'}`
	);
}

export function stopMonitorFile(): void {
	if (state.timer) clearInterval(state.timer);
	state.timer = null;
}
