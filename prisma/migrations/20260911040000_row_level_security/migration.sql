-- Isolation multi-tenant : deuxième ligne de défense, indépendante du code applicatif.
-- Voir docs/04-isolation-multi-tenant.md
--
-- Deux variables de session, positionnées par SET LOCAL dans chaque transaction :
--   app.current_user_id     -> le créateur authentifié dans le studio
--   app.current_project_id  -> le projet dont on sert le runtime public
-- Une variable absente vaut NULL : toute comparaison échoue, donc refus par défaut.

-- 1. Droits du rôle applicatif.
--    Le rôle lui-même est créé hors migration par l'exploitant (scripts/setup-db.sql) :
--    les migrations tournent avec le propriétaire des tables, qui n'a pas CREATEROLE.
--    Les octrois sont donc conditionnels à l'existence du rôle.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT USAGE ON SCHEMA public TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appforge_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appforge_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appforge_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END
$$;

-- 2. Fonctions d'aide : lecture tolérante des variables de session.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_project_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_project_id', true), '')::uuid
$$;

-- 3. Projets.
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;

CREATE POLICY project_owner_read ON "Project" FOR SELECT
  USING (
    "ownerId" = app_current_user_id()
    OR "id" = app_current_project_id()
  );

CREATE POLICY project_owner_insert ON "Project" FOR INSERT
  WITH CHECK ("ownerId" = app_current_user_id());

CREATE POLICY project_owner_update ON "Project" FOR UPDATE
  USING ("ownerId" = app_current_user_id())
  WITH CHECK ("ownerId" = app_current_user_id());

CREATE POLICY project_owner_delete ON "Project" FOR DELETE
  USING ("ownerId" = app_current_user_id());

-- 4. Tables rattachées à un projet.
--    Accès si l'utilisateur courant possède le projet, ou si le projet est le projet
--    de runtime explicitement ouvert pour cette transaction.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ProjectVersion', 'ChatMessage', 'ProjectCheck',
    'AppRecord', 'AppEndUser', 'AppEndUserSession', 'AppEvent'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR ALL
        USING (
          "projectId" = app_current_project_id()
          OR EXISTS (
            SELECT 1 FROM "Project" p
            WHERE p."id" = %I."projectId" AND p."ownerId" = app_current_user_id()
          )
        )
        WITH CHECK (
          "projectId" = app_current_project_id()
          OR EXISTS (
            SELECT 1 FROM "Project" p
            WHERE p."id" = %I."projectId" AND p."ownerId" = app_current_user_id()
          )
        )
    $f$, lower(t) || '_scope', t, t, t);
  END LOOP;
END
$$;

-- 5. Index de recherche du runtime public.
CREATE INDEX IF NOT EXISTS "Project_published_slug_idx"
  ON "Project" ("slug") WHERE "publishedAt" IS NOT NULL;
