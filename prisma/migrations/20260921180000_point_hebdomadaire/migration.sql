-- Le point hebdomadaire de Léa.
--
-- Le produit mesure beaucoup de choses et les range dans autant d'écrans : une note
-- d'audit, des pannes ouvertes, des pages hors de l'index, des recherches qui montent, des
-- articles publiés, une fréquence chez les assistants. Chacun de ces écrans est juste, et
-- personne ne les ouvre tous. Ce qui manque n'est pas une mesure de plus, c'est quelqu'un
-- qui regarde l'ensemble et dise par quoi commencer.
--
-- Le point est conservé plutôt que recalculé à l'ouverture, pour deux raisons. Il coûte un
-- appel : le refaire à chaque visite facturerait la lecture. Et il date — « voilà où vous
-- en étiez lundi » se compare au lundi suivant, ce qu'un texte recalculé à la volée ne
-- permettrait jamais.

CREATE TABLE "PointHebdo" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"       UUID NOT NULL,
  "userId"       UUID NOT NULL,

  -- Où en est ce site, en quelques phrases, sur des faits mesurés.
  "etat"         TEXT NOT NULL DEFAULT '',
  -- Les prochaines actions : ce qu'il faut faire, pourquoi, et par quel spécialiste.
  "actions"      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Ce qui a servi à l'écrire, pour pouvoir relire un point ancien sans deviner.
  "fondement"    JSONB NOT NULL DEFAULT '{}'::jsonb,

  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PointHebdo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PointHebdo_siteId_createdAt_idx" ON "PointHebdo" ("siteId", "createdAt" DESC);

ALTER TABLE "PointHebdo" ADD CONSTRAINT "PointHebdo_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointHebdo" ADD CONSTRAINT "PointHebdo_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PointHebdo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PointHebdo" FORCE ROW LEVEL SECURITY;
CREATE POLICY pointhebdo_owner ON "PointHebdo" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PointHebdo" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;

-- L'automatisation qui le produit, et sa cadence.
ALTER TABLE "SiteAutomatisation" ADD COLUMN "point" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteAutomatisation" ADD COLUMN "pointAt" TIMESTAMP(3);
