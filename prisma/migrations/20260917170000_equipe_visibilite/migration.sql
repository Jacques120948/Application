-- Les échanges avec l'équipe de visibilité.
--
-- Une table à part, et non une colonne de plus sur `AgentNote` : celle-ci pend à un projet du
-- constructeur, et ce ne sont ni les mêmes interlocuteurs, ni le même objet, ni le même
-- périmètre de lecture. Les fondre aurait demandé un identifiant de projet facultatif —
-- c'est-à-dire une colonne vide dans la moitié des lignes et une jointure qui ment.

CREATE TABLE "VisibilityNote" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"       UUID NOT NULL,
  "userId"       UUID NOT NULL,
  "agent"        TEXT NOT NULL,
  "question"     TEXT NOT NULL,
  "answer"       TEXT NOT NULL,
  "takeaway"     TEXT,
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisibilityNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisibilityNote_siteId_createdAt_idx" ON "VisibilityNote" ("siteId", "createdAt");
CREATE INDEX "VisibilityNote_siteId_agent_createdAt_idx"
  ON "VisibilityNote" ("siteId", "agent", "createdAt");

ALTER TABLE "VisibilityNote" ADD CONSTRAINT "VisibilityNote_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisibilityNote" ADD CONSTRAINT "VisibilityNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cloisonnement. Une conversation est ce qu'une personne a de plus personnel dans ce
-- produit : elle y décrit son métier, ses doutes et ses projets. `FORCE` est indispensable —
-- sans lui, le propriétaire des tables contournerait ses propres règles, et c'est
-- précisément lui qui exécute les migrations.

ALTER TABLE "VisibilityNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisibilityNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY visibilitynote_owner ON "VisibilityNote" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- L'octroi est conditionnel, comme dans toutes les migrations qui l'ont précédé : le rôle
-- existe sur une installation montée avec scripts/setup-db.sql, et pas sur une base gérée où
-- l'application se connecte autrement. Un GRANT inconditionnel échoue alors — et une
-- migration en échec bloque toutes les suivantes, donc tous les déploiements.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "VisibilityNote" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
