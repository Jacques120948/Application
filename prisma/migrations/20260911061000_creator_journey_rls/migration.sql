-- Les deux nouvelles tables sont rattachées à un créateur et non à un projet : elles
-- utilisent app.current_user_id, comme la table Project. Même principe qu'en
-- 20260911040000 : le code applique déjà la portée, la base la garantit.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CreatorProfile", "Idea" TO appforge_app;
  END IF;
END
$$;

ALTER TABLE "CreatorProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY creatorprofile_owner ON "CreatorProfile" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "Idea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Idea" FORCE ROW LEVEL SECURITY;
CREATE POLICY idea_owner ON "Idea" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());
