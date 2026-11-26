-- A monitor now goes down only after three failed checks in a row: retries defaults to 2
-- (down after retries + 1 failures). Monitors still on the old default of 0 move to 2.
-- The column default stays 0 in the table; new monitors get 2 from the app's DEFAULTS.
--
-- Rollback: UPDATE monitors SET retries = 0 WHERE retries = 2;
UPDATE monitors SET retries = 2 WHERE retries = 0;
