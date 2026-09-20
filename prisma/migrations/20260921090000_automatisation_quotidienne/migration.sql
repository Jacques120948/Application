-- L'automatisation quotidienne, et la mémoire des chiffres de recherche.
--
-- Jusqu'ici tout partait d'un clic : on ouvrait un écran, on demandait à Google, on lisait.
-- Ce qui ne s'ouvre pas ne se sait pas — et les choses qui comptent arrivent précisément
-- les semaines où l'on n'ouvre rien.
--
-- Deux tables, pour deux besoins différents.
--
-- `SiteAutomatisation` porte ce que la personne a accepté de laisser tourner seul. Une
-- ligne par site, tout à « non » au départ : rien ne se déclenche parce qu'une
-- fonctionnalité existe. La rédaction automatique dépense des crédits, donc elle porte en
-- plus son rythme — ce qui est autorisé est aussi ce qui est borné.
--
-- `ReleveRecherche` garde une photographie par jour. Les écrans de recherche ne conservent
-- rien : ils lisent chez Google et jettent, et c'est bien ainsi pour un écran qu'on ouvre.
-- Mais « cette requête a gagné quatre places cette semaine » ne se dit pas sans une trace
-- d'hier, et Google ne rend pas l'historique sous cette forme.

CREATE TABLE "SiteAutomatisation" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"      UUID NOT NULL,
  "userId"      UUID NOT NULL,

  -- Demander chaque nuit à Google l'état de quelques pages. Gratuit : l'API de Google, sur
  -- le quota de la personne.
  "indexation"  BOOLEAN NOT NULL DEFAULT false,
  -- Garder une trace quotidienne des chiffres de recherche. Gratuit aussi.
  "releve"      BOOLEAN NOT NULL DEFAULT false,
  -- Faire écrire les articles du calendrier sans les demander. DÉPENSE DES CRÉDITS.
  "redaction"   BOOLEAN NOT NULL DEFAULT false,
  -- Déposer l'article écrit en brouillon dans Shopify. Jamais publié : voir publication.ts.
  "depot"       BOOLEAN NOT NULL DEFAULT false,

  -- Le blog Shopify qui reçoit les dépôts automatiques. Vide : le premier de la boutique.
  "blogId"      TEXT NOT NULL DEFAULT '',
  -- Le rythme autorisé, repris du calendrier. C'est la borne de la dépense.
  "parPeriode"  INTEGER NOT NULL DEFAULT 1,
  -- semaine | mois
  "periode"     TEXT NOT NULL DEFAULT 'semaine',

  -- Derniers passages, pour ne pas refaire deux fois le même travail dans la même journée.
  "indexeAt"    TIMESTAMP(3),
  "releveAt"    TIMESTAMP(3),
  "redigeAt"    TIMESTAMP(3),

  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SiteAutomatisation_pkey" PRIMARY KEY ("id")
);

-- Un seul réglage par site : deux lignes diraient deux choses, et l'une des deux serait lue.
CREATE UNIQUE INDEX "SiteAutomatisation_siteId_key" ON "SiteAutomatisation" ("siteId");

ALTER TABLE "SiteAutomatisation" ADD CONSTRAINT "SiteAutomatisation_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteAutomatisation" ADD CONSTRAINT "SiteAutomatisation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReleveRecherche" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"      UUID NOT NULL,
  "userId"      UUID NOT NULL,

  -- Le jour relevé, à minuit. Les chiffres de Google portent sur les 28 jours qui précèdent.
  "jour"        DATE NOT NULL,
  "clics"       INTEGER NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  -- Les requêtes les plus vues, telles que Google les rend ce jour-là. Assez pour dire
  -- qu'une requête a bougé, pas assez pour reconstituer une base de mots-clés.
  "requetes"    JSONB NOT NULL DEFAULT '[]'::jsonb,

  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReleveRecherche_pkey" PRIMARY KEY ("id")
);

-- Un relevé par site et par jour. Deux passages du planificateur le même jour écrasent le
-- premier plutôt que d'ajouter une ligne : la photographie du jour est unique par définition.
CREATE UNIQUE INDEX "ReleveRecherche_siteId_jour_key" ON "ReleveRecherche" ("siteId", "jour");
CREATE INDEX "ReleveRecherche_siteId_jour_idx" ON "ReleveRecherche" ("siteId", "jour" DESC);

ALTER TABLE "ReleveRecherche" ADD CONSTRAINT "ReleveRecherche_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleveRecherche" ADD CONSTRAINT "ReleveRecherche_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cloisonnement. Les chiffres de recherche d'un site sont une information commerciale de
-- premier ordre : savoir sur quels mots un concurrent monte vaut cher. `FORCE` est
-- indispensable — sans lui, le propriétaire des tables contournerait ses propres règles, et
-- c'est précisément lui qui exécute les migrations.

ALTER TABLE "SiteAutomatisation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteAutomatisation" FORCE ROW LEVEL SECURITY;
CREATE POLICY siteautomatisation_owner ON "SiteAutomatisation" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "ReleveRecherche" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleveRecherche" FORCE ROW LEVEL SECURITY;
CREATE POLICY releverecherche_owner ON "ReleveRecherche" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteAutomatisation" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ReleveRecherche" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
