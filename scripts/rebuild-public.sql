-- DESTRUCTIVE: only the separately approved rebuild command may execute this file.
-- The caller has checked the exact database, verified TLS, backup, absence of
-- other sessions/custom schemas/public extensions and acquired the migration lock.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
