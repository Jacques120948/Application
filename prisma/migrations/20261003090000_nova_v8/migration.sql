-- Nova V8 : le CRM (HubSpot), réduit à des comptes par jour et à un instantané de cohortes.
-- Aucun contact, aucun nom, aucun courriel.
CREATE TABLE "CrmJour" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "jour"      DATE NOT NULL,
  "prospects" INTEGER NOT NULL DEFAULT 0,
  "clients"   INTEGER NOT NULL DEFAULT 0,
  "canaux"    JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmJour_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmJour_userId_jour_key" ON "CrmJour" ("userId", "jour");
CREATE INDEX "CrmJour_userId_jour_idx" ON "CrmJour" ("userId", "jour" DESC);
ALTER TABLE "CrmJour" ADD CONSTRAINT "CrmJour_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrmSynchro" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL,
  "etat"             TEXT NOT NULL DEFAULT 'jamais',
  "message"          TEXT NOT NULL DEFAULT '',
  "synchroAt"        TIMESTAMP(3),
  "essaiAt"          TIMESTAMP(3),
  "couvertureDepuis" DATE,
  "fuseau"           TEXT NOT NULL DEFAULT '',
  "devise"           TEXT NOT NULL DEFAULT '',
  "tronque"          BOOLEAN NOT NULL DEFAULT false,
  "instantane"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmSynchro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmSynchro_userId_key" ON "CrmSynchro" ("userId");
ALTER TABLE "CrmSynchro" ADD CONSTRAINT "CrmSynchro_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmJour" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmJour" FORCE ROW LEVEL SECURITY;
CREATE POLICY crmjour_owner ON "CrmJour" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "CrmSynchro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmSynchro" FORCE ROW LEVEL SECURITY;
CREATE POLICY crmsynchro_owner ON "CrmSynchro" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmJour" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSynchro" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
