-- Provisionnement des rôles PostgreSQL. À exécuter une fois par environnement,
-- avec un rôle disposant de CREATEROLE (superutilisateur en développement).
--
--   psql -v app_password="'...'" -f scripts/setup-db.sql -d appforge_dev
--
-- Deux rôles, volontairement distincts (voir docs/04-isolation-multi-tenant.md) :
--   appforge      propriétaire des tables, utilisé UNIQUEMENT par prisma migrate
--   appforge_app  rôle applicatif, non propriétaire, soumis au Row Level Security

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    CREATE ROLE appforge_app LOGIN PASSWORD 'appforge_app_dev';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO appforge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appforge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO appforge_app;
