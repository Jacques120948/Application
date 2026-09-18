-- Les articles rédigés par l'équipe.
--
-- Un article est le seul contenu long que le produit fabrique, et le plus cher : quinze à
-- trente crédits. Il ne peut donc pas vivre dans l'écran qui l'a demandé. Un texte payé qui
-- disparaît au rechargement de la page est un texte volé — la règle est la même que pour les
-- corrections, et elle vaut ici davantage encore.
--
-- Le corps est gardé en Markdown plutôt qu'en HTML : c'est ce qu'un modèle écrit le plus
-- proprement, ce qui se relit sans balise, et ce qui se convertit ensuite vers n'importe
-- quel site. Les questions sont à part du corps, parce qu'elles ne s'affichent pas comme lui
-- et qu'elles se déclarent en FAQ, ce qui est précisément ce que les contrôles GEO attendent.

CREATE TABLE "SiteArticle" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"          UUID NOT NULL,
  "userId"          UUID NOT NULL,
  "sujet"           TEXT NOT NULL,
  "demande"         TEXT NOT NULL DEFAULT '',
  "fondement"       TEXT NOT NULL DEFAULT '',
  "checkIds"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "titre"           TEXT NOT NULL,
  "chapo"           TEXT NOT NULL DEFAULT '',
  "corps"           TEXT NOT NULL,
  "questions"       JSONB,
  "metaTitle"       TEXT NOT NULL DEFAULT '',
  "metaDescription" TEXT NOT NULL DEFAULT '',
  "wordCount"       INTEGER NOT NULL DEFAULT 0,
  "creditsSpent"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteArticle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteArticle_siteId_createdAt_idx" ON "SiteArticle" ("siteId", "createdAt");

ALTER TABLE "SiteArticle" ADD CONSTRAINT "SiteArticle_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteArticle" ADD CONSTRAINT "SiteArticle_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cloisonnement. Un article non publié est un texte que personne d'autre ne doit lire : il
-- porte le métier de la personne, et il lui a coûté des crédits. `FORCE` est indispensable —
-- sans lui, le propriétaire des tables contournerait ses propres règles, et c'est
-- précisément lui qui exécute les migrations.

ALTER TABLE "SiteArticle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteArticle" FORCE ROW LEVEL SECURITY;
CREATE POLICY sitearticle_owner ON "SiteArticle" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- L'octroi est conditionnel, comme dans toutes les migrations qui l'ont précédé : le rôle
-- existe sur une installation montée avec scripts/setup-db.sql, et pas sur une base gérée où
-- l'application se connecte autrement. Un GRANT inconditionnel échoue alors — et une
-- migration en échec bloque toutes les suivantes, donc tous les déploiements.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteArticle" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
