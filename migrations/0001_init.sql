-- 0001_init.sql
-- better-auth core schema (the shape @better-auth/cli migrate produces), plus the app tables.

CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "role" text not null);

CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE INDEX "account_userId_idx" on "account" ("userId");
CREATE INDEX "session_userId_idx" on "session" ("userId");
CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

-- Monitors: a URL health check (type 'http') or a Docker container's state (type 'docker').
-- status is the latest verdict: 'up' | 'down' | 'pending' (failing with retries left, or a
-- container starting) | 'unknown' (never checked) | 'paused' (disabled).
CREATE TABLE monitors (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT,
	type TEXT NOT NULL CHECK (type IN ('http', 'docker')),
	-- http
	url TEXT,
	method TEXT NOT NULL DEFAULT 'GET',
	accepted_statuses TEXT NOT NULL DEFAULT '200-299',
	keyword TEXT,
	ignore_tls INTEGER NOT NULL DEFAULT 0,
	-- docker
	container TEXT,
	docker_host TEXT,
	-- scheduling
	interval_seconds INTEGER NOT NULL DEFAULT 60,
	timeout_seconds INTEGER NOT NULL DEFAULT 10,
	retries INTEGER NOT NULL DEFAULT 0,
	enabled INTEGER NOT NULL DEFAULT 1,
	public INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	-- latest state
	status TEXT NOT NULL DEFAULT 'unknown',
	message TEXT,
	latency_ms INTEGER,
	failures INTEGER NOT NULL DEFAULT 0,
	last_checked_at INTEGER,
	last_change_at INTEGER,
	created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

-- Names identify monitors for API and MCP callers, so they are unique (ignoring case).
CREATE UNIQUE INDEX idx_monitors_name ON monitors(name COLLATE NOCASE);

-- One row per check.
CREATE TABLE heartbeats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	latency_ms INTEGER,
	message TEXT,
	checked_at INTEGER NOT NULL
);
CREATE INDEX idx_heartbeats_monitor_time ON heartbeats(monitor_id, checked_at);
CREATE INDEX idx_heartbeats_time ON heartbeats(checked_at);

-- Instance-wide settings, such as the public status page title and description.
CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- OAuth clients registered by MCP clients (dynamic client registration, all public + PKCE).
CREATE TABLE oauth_clients (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	redirect_uris TEXT NOT NULL,
	client_uri TEXT,
	created_at INTEGER NOT NULL,
	approved_at INTEGER
);

-- API keys (sty_<id>_<secret>, argon2-hashed). scopes: JSON array of 'status:read' | 'monitors:write'.
-- oauth_client_id is set for keys made by approving an MCP client's OAuth sign-in.
CREATE TABLE api_keys (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	label TEXT NOT NULL,
	hash TEXT NOT NULL,
	scopes TEXT NOT NULL,
	oauth_client_id TEXT REFERENCES oauth_clients(id) ON DELETE SET NULL,
	created_at INTEGER NOT NULL,
	last_used_at INTEGER
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

CREATE TABLE oauth_codes (
	code_hash TEXT PRIMARY KEY,
	client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
	api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
	redirect_uri TEXT NOT NULL,
	code_challenge TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE TABLE oauth_tokens (
	token_hash TEXT PRIMARY KEY,
	kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
	api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
	client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	used_at INTEGER
);
CREATE INDEX idx_oauth_tokens_key ON oauth_tokens(api_key_id);
