-- Monitors declared in the monitors file (MONITORS_FILE). config_managed = 1 for monitors the
-- file created or adopted (matched by name), so removing one from the file deletes it again
-- while monitors made in the UI or API are never touched.
--
-- Rollback: ALTER TABLE monitors DROP COLUMN config_managed;
ALTER TABLE monitors ADD COLUMN config_managed INTEGER NOT NULL DEFAULT 0;
