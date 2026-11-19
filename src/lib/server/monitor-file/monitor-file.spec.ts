import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseMonitorFile, substituteEnv } from './parse.js';

// apply.ts uses the shared database: point it at an in-memory one before anything loads config.
process.env.DATABASE_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-test-secret';

type Apply = typeof import('./apply.js');
type Repo = typeof import('../db/repo/monitors.js');
type Service = typeof import('../monitor/service.js');
type Sync = typeof import('./index.js');
let apply: Apply;
let repo: Repo;
let service: Service;
let sync: Sync;
let db: import('../db/index.js').Db;
let dir: string;

beforeAll(async () => {
	apply = await import('./apply.js');
	repo = await import('../db/repo/monitors.js');
	service = await import('../monitor/service.js');
	sync = await import('./index.js');
	db = (await import('../db/index.js')).getDb();
	dir = await mkdtemp(path.join(tmpdir(), 'statty-monitors-'));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

// Unreachable targets: nothing in these tests waits for a check or a favicon.
const URL_A = 'http://127.0.0.1:9/a';
const URL_B = 'http://127.0.0.1:9/b';

describe('parseMonitorFile', () => {
	it('keeps only the fields an entry sets', () => {
		const file = parseMonitorFile(`monitors:\n  - name: Web\n    type: http\n    url: ${URL_A}\n`);
		expect(file.monitors).toEqual([{ name: 'Web', type: 'http', url: URL_A }]);
		expect(file.prune).toBe(true);
		expect(file.statusPage).toBeNull();
	});

	it('treats an empty file or section as no monitors', () => {
		expect(parseMonitorFile('').monitors).toEqual([]);
		expect(parseMonitorFile('monitors:\n# none yet\n').monitors).toEqual([]);
	});

	it('substitutes environment variables', () => {
		expect(substituteEnv('https://${HOST}/x and $${LITERAL}', { HOST: 'h.local' })).toBe(
			'https://h.local/x and ${LITERAL}'
		);
		expect(() => substituteEnv('${MISSING}', {})).toThrow(/MISSING/);
	});

	it('lists every problem at once', () => {
		const raw = [
			'prune: maybe',
			'extra: 1',
			'monitors:',
			'  - name: A',
			'    type: http',
			'  - name: a',
			'    type: docker',
			'    container: c',
			'    interval: 30',
			'  - name: B',
			'    type: ftp'
		].join('\n');
		let message = '';
		try {
			parseMonitorFile(raw);
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toMatch(/prune must be true or false/);
		expect(message).toMatch(/unknown top-level key "extra"/);
		expect(message).toMatch(/"A"\): an http monitor needs a url/);
		expect(message).toMatch(/unknown field "interval"/);
		expect(message).toMatch(/monitors\[2\] \("B"\)\.type/);
	});

	it('rejects duplicate names ignoring case', () => {
		const raw = `monitors:\n  - {name: Web, type: http, url: ${URL_A}}\n  - {name: web, type: http, url: ${URL_B}}\n`;
		expect(() => parseMonitorFile(raw)).toThrow(/used twice/);
	});

	it('reads the status page', () => {
		const file = parseMonitorFile('statusPage:\n  title: Acme\nprune: false\n');
		expect(file.statusPage).toEqual({ title: 'Acme', description: '' });
		expect(file.prune).toBe(false);
	});
});

describe('applyMonitorFile', () => {
	it('creates, updates only set fields, adopts by name and prunes its own monitors', async () => {
		// Made in the UI: adopted when the file names it, never deleted otherwise.
		const fromUi = repo.createMonitor(
			db,
			{ name: 'Shared', type: 'http', url: URL_A, retries: 3 },
			null
		);
		const untouched = repo.createMonitor(db, { name: 'UI only', type: 'http', url: URL_A }, null);

		let result = await apply.applyMonitorFile(
			parseMonitorFile(
				[
					'statusPage: {title: Acme Status, description: Hello}',
					'monitors:',
					`  - {name: Web, type: http, url: ${URL_A}, intervalSeconds: 30}`,
					`  - {name: shared, type: http, url: ${URL_B}}`,
					'  - {name: Db, type: docker, container: postgres, public: false}'
				].join('\n')
			)
		);
		expect(result.created.sort()).toEqual(['Db', 'Web']);
		expect(result.updated).toEqual(['shared']);
		expect(result.statusPage).toBe('updated');

		const shared = repo.getMonitor(db, fromUi.id)!;
		expect(shared.name).toBe('shared');
		expect(shared.url).toBe(URL_B);
		expect(shared.retries).toBe(3); // not in the file: left alone
		expect(shared.managedByConfig).toBe(true);
		expect(repo.findMonitor(db, 'Db')?.public).toBe(false);

		// A UI edit to a field the file sets is undone; one it doesn't set survives.
		const web = repo.findMonitor(db, 'Web')!;
		await service.editMonitor(
			web.id,
			{ intervalSeconds: 120, retries: 5 },
			{ waitForCheck: false }
		);
		result = await apply.applyMonitorFile(
			parseMonitorFile(
				[
					'monitors:',
					`  - {name: Web, type: http, url: ${URL_A}, intervalSeconds: 30}`,
					`  - {name: shared, type: http, url: ${URL_B}}`
				].join('\n')
			)
		);
		expect(result.updated).toEqual(['Web']);
		expect(result.unchanged).toEqual(['shared']);
		expect(result.deleted).toEqual(['Db']);
		expect(repo.getMonitor(db, web.id)?.intervalSeconds).toBe(30);
		expect(repo.getMonitor(db, web.id)?.retries).toBe(5);
		expect(repo.getMonitor(db, untouched.id)).toBeDefined();

		// prune: false hands monitors removed from the file back to the UI instead.
		result = await apply.applyMonitorFile(
			parseMonitorFile(`prune: false\nmonitors:\n  - {name: Web, type: http, url: ${URL_A}}\n`)
		);
		expect(result.deleted).toEqual([]);
		expect(repo.getMonitor(db, fromUi.id)?.managedByConfig).toBe(false);
	});

	it('reports an entry the database refuses without dropping its monitor', async () => {
		const result = await apply.applyMonitorFile(
			parseMonitorFile(
				`monitors:\n  - {name: Web, type: http, url: ${URL_A}, intervalSeconds: 10, timeoutSeconds: 20}\n`
			)
		);
		expect(result.failed).toEqual([{ name: 'Web', error: expect.stringMatching(/timeout/) }]);
		expect(repo.findMonitor(db, 'Web')).toBeDefined();
		expect(result.deleted).toEqual([]);
	});

	it('applies the file only when it changes, and never a broken one', async () => {
		const file = path.join(dir, 'statty.yaml');
		await writeFile(file, `monitors:\n  - {name: Synced, type: http, url: ${URL_A}}\n`);
		await sync.syncMonitorFile(file, true);
		expect(repo.findMonitor(db, 'Synced')?.managedByConfig).toBe(true);

		// A typo must not prune everything the file declared.
		await writeFile(file, 'monitors:\n  - {name: Synced, type: htp}\n');
		await sync.syncMonitorFile(file);
		expect(repo.findMonitor(db, 'Synced')).toBeDefined();
	});
});
