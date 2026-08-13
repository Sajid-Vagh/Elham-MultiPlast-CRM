-- Migration 079: Re-run the per-user read backfill for legacy-read leads
--
-- Migration 078 backfilled contacts.read_by from the legacy global is_read flag
-- ONCE at the time it ran. Any lead marked read AFTER that point by the old
-- (pre-per-user) server build got is_read = true but an empty read_by, so the
-- new per-user fetch logic (isRead = readBy.includes(user)) reported it unread
-- and the blue dot resurrected for leads the user had already acknowledged.
--
-- This re-runs the same idempotent backfill so any environment that applied 078
-- before the old build finished serving reads converges to the correct state.
-- Safe to run at any time: it only ADDS all active user IDs to read_by rows
-- that are still empty while carrying the global "read" flag, never removes.

UPDATE contacts
  SET read_by = ARRAY(SELECT id FROM users)
  WHERE read_by = '{}' AND is_read = true;
