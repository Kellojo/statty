import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { migrate } from './migrate.js';

export type Db = Database.Database;

export function openDatabase(filename: string): Db {
	if (filename !== ':memory:') {
		fs.mkdirSync(path.dirname(filename), { recursive: true });
	}
	const db = new Database(filename);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	// With WAL, NORMAL stays consistent across crashes and skips an fsync per write.
	db.pragma('synchronous = NORMAL');
	db.pragma('journal_size_limit = 67108864');
	migrate(db);
	db.pragma('optimize = 0x10002');
	return db;
}

let instance: Db | null = null;

export function getDb(): Db {
	if (!instance) instance = openDatabase(config.DATABASE_PATH);
	return instance;
}

export function closeDb(): void {
	instance?.close();
	instance = null;
}
