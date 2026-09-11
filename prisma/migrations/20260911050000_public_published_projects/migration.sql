-- Une application publiée est publique par construction : son adresse est partagée par
-- son créateur. Le runtime doit donc pouvoir la retrouver par son slug sans contexte
-- d'utilisateur. Les tables rattachées (données, comptes des utilisateurs finaux)
-- restent, elles, protégées par app.current_project_id.

DROP POLICY IF EXISTS project_owner_read ON "Project";

CREATE POLICY project_read ON "Project" FOR SELECT
  USING (
    "ownerId" = app_current_user_id()
    OR "id" = app_current_project_id()
    OR ("publishedAt" IS NOT NULL AND "deletedAt" IS NULL)
  );
