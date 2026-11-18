-- 0003_favicons.sql
-- Site icons for HTTP monitors, cached per origin (scheme://host:port), so monitors on
-- one site share one icon. A failed search keeps any earlier icon and sets `failed`, so
-- it is retried after a day rather than on every check; good icons are refreshed weekly.
CREATE TABLE favicons (
	origin TEXT PRIMARY KEY,
	content_type TEXT,
	body BLOB,
	-- sha256 of body (hex): the ETag, and the cache-busting version in faviconUrl.
	hash TEXT,
	-- When the last search finished, found or not.
	fetched_at INTEGER NOT NULL,
	failed INTEGER NOT NULL DEFAULT 0
);
