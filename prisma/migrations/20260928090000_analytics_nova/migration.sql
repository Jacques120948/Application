-- Nova V3 : les visites de Google Analytics 4, agrégées par jour.
--
-- Des totaux par canal, par appareil et par page d'entrée. Aucun identifiant de visiteur :
-- l'API de rapports n'en donne pas, et on n'en demande pas.
CREATE TABLE "AnalyticsJour" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"          UUID NOT NULL,
  "propriete"       TEXT NOT NULL,
  "jour"            DATE NOT NULL,
  "sessions"        INTEGER NOT NULL DEFAULT 0,
  "sessionsEngagees" INTEGER NOT NULL DEFAULT 0,
  "achats"          INTEGER NOT NULL DEFAULT 0,
  "revenuCents"     BIGINT NOT NULL DEFAULT 0,
  "canaux"          JSONB NOT NULL DEFAULT '{}',
  "appareils"       JSONB NOT NULL DEFAULT '{}',
  "pages"           JSONB NOT NULL DEFAULT '[]',
  "pagesSeo"        JSONB NOT NULL DEFAULT '[]',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsJour_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsJour_userId_propriete_jour_key" ON "AnalyticsJour" ("userId", "propriete", "jour");
CREATE INDEX "AnalyticsJour_userId_jour_idx" ON "AnalyticsJour" ("userId", "jour" DESC);
ALTER TABLE "AnalyticsJour"
  ADD CONSTRAINT "AnalyticsJour_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La propriété suivie et l'état de sa dernière lecture.
CREATE TABLE "AnalyticsSynchro" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL,
  "propriete"   TEXT NOT NULL DEFAULT '',
  "nom"         TEXT NOT NULL DEFAULT '',
  "etat"        TEXT NOT NULL DEFAULT 'jamais',
  "message"     TEXT NOT NULL DEFAULT '',
  "synchroAt"   TIMESTAMP(3),
  "essaiAt"     TIMESTAMP(3),
  "couvertureDepuis" DATE,
  "devise"      TEXT NOT NULL DEFAULT '',
  "fuseau"      TEXT NOT NULL DEFAULT '',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsSynchro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsSynchro_userId_key" ON "AnalyticsSynchro" ("userId");
ALTER TABLE "AnalyticsSynchro"
  ADD CONSTRAINT "AnalyticsSynchro_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsJour" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsJour" FORCE ROW LEVEL SECURITY;
CREATE POLICY analyticsjour_owner ON "AnalyticsJour" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AnalyticsSynchro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsSynchro" FORCE ROW LEVEL SECURITY;
CREATE POLICY analyticssynchro_owner ON "AnalyticsSynchro" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AnalyticsJour" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AnalyticsSynchro" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
