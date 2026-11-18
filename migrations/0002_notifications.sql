-- 0002_notifications.sql
-- Notification channels: where Statty sends a message when a monitor goes down or recovers.
-- type names the channel kind ('gotify' for now); config is its JSON settings, with secrets
-- (such as a Gotify app token) encrypted. type has no CHECK so new kinds need no table rebuild;
-- the app validates it.
CREATE TABLE notification_channels (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL,
	config TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	-- 1: every monitor, including ones added later. 0: only those in notification_channel_monitors.
	all_monitors INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE notification_channel_monitors (
	channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
	monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
	PRIMARY KEY (channel_id, monitor_id)
);
CREATE INDEX idx_notification_channel_monitors_monitor ON notification_channel_monitors(monitor_id);
