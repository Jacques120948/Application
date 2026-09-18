-- La surveillance de ce qui casse.
--
-- Un audit est une photographie : il dit l'état d'un site le jour où on l'a pris. Or les
-- pannes qui coûtent le plus cher ne se voient pas le jour où elles arrivent. Un thème qui
-- pousse une balise « noindex », un robots.txt qui se referme, un hébergeur qui tombe : le
-- site continue de s'afficher pour son propriétaire, et disparaît des moteurs pendant des
-- mois sans que personne ne s'en aperçoive. C'est la panne la plus chère du métier, et la
-- seule qu'on ne découvre jamais soi-même.
--
-- Un constat s'ouvre quand le défaut apparaît et se ferme quand il a disparu, plutôt que de
-- créer une ligne par passage. Sans cela, un site en panne pendant six semaines produirait
-- six lignes identiques, et l'écran dirait « six problèmes » là où il y en a un depuis six
-- semaines — ce qui est une autre façon de mentir.

CREATE TABLE "SiteWatch" (
  "id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"   UUID NOT NULL,
  "userId"   UUID NOT NULL,
  -- Identifiant stable du contrôle : watch.unreachable, watch.noindex, ...
  "checkId"  TEXT NOT NULL,
  -- L'adresse concernée, quand le constat porte sur une page précise.
  "url"      TEXT NOT NULL DEFAULT '',
  -- Ce qui a été constaté, dit comme la personne le lira.
  "detail"   TEXT NOT NULL DEFAULT '',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Rempli au premier contrôle où le défaut a disparu.
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "SiteWatch_pkey" PRIMARY KEY ("id")
);

-- Un seul constat ouvert par contrôle et par adresse : c'est ce qui distingue « le même
-- problème continue » de « un problème de plus ».
CREATE UNIQUE INDEX "SiteWatch_ouvert_unique"
  ON "SiteWatch" ("siteId", "checkId", "url") WHERE "closedAt" IS NULL;
CREATE INDEX "SiteWatch_siteId_closedAt_idx" ON "SiteWatch" ("siteId", "closedAt");

ALTER TABLE "SiteWatch" ADD CONSTRAINT "SiteWatch_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteWatch" ADD CONSTRAINT "SiteWatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quand ce site a été contrôlé pour la dernière fois. Sur `Site` plutôt que dans une table à
-- part : c'est un attribut du site, et c'est ce qui permet de ne pas le recontrôler deux
-- fois dans la même semaine si le planificateur appelle deux fois.
ALTER TABLE "Site" ADD COLUMN "watchedAt" TIMESTAMP(3);

-- Cloisonnement. Les pannes d'un site sont une information commerciale : savoir que le site
-- d'un concurrent est tombé a de la valeur. `FORCE` est indispensable — sans lui, le
-- propriétaire des tables contournerait ses propres règles, et c'est précisément lui qui
-- exécute les migrations.

ALTER TABLE "SiteWatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteWatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY sitewatch_owner ON "SiteWatch" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteWatch" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
