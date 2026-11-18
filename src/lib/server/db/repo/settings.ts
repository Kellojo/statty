import type { StatusPageSettings } from '$lib/types.js';
import type { Db } from '../index.js';

const DEFAULT_STATUS_PAGE: StatusPageSettings = {
	title: 'Service status',
	description: ''
};

function get(db: Db, key: string): string | undefined {
	return (
		db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
	)?.value;
}

function set(db: Db, key: string, value: string): void {
	db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}

export function getStatusPageSettings(db: Db): StatusPageSettings {
	return {
		title: get(db, 'status_page.title') ?? DEFAULT_STATUS_PAGE.title,
		description: get(db, 'status_page.description') ?? DEFAULT_STATUS_PAGE.description
	};
}

export function setStatusPageSettings(db: Db, input: StatusPageSettings): StatusPageSettings {
	db.transaction(() => {
		set(db, 'status_page.title', input.title);
		set(db, 'status_page.description', input.description);
	})();
	return getStatusPageSettings(db);
}
