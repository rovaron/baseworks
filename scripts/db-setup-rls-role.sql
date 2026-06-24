-- scripts/db-setup-rls-role.sql
-- Creates the NON-OWNER, RLS-enforced login role used by tenant request paths.
-- Run as the database owner/superuser. Idempotent. The password is interpolated
-- by scripts/db-setup-rls-role.ts from BASEWORKS_RLS_PASSWORD (never committed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseworks_rls') THEN
    EXECUTE format('CREATE ROLE baseworks_rls LOGIN NOBYPASSRLS PASSWORD %L', :'rls_password');
  ELSE
    EXECUTE format('ALTER ROLE baseworks_rls LOGIN NOBYPASSRLS PASSWORD %L', :'rls_password');
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO baseworks_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO baseworks_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO baseworks_rls;
-- Future tables created by the owner are auto-granted to the RLS role.
ALTER DEFAULT PRIVILEGES FOR ROLE baseworks IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baseworks_rls;
ALTER DEFAULT PRIVILEGES FOR ROLE baseworks IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO baseworks_rls;
