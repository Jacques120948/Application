-- Lina V1 : un index de la base clients, sans nom, courriel, téléphone ni adresse.
CREATE TABLE "LinaClient" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL,
  "source"           TEXT NOT NULL,
  "ref"              TEXT NOT NULL,
  "creeLe"           TIMESTAMP(3) NOT NULL,
  "derniereCommande" TIMESTAMP(3),
  "commandes"        INTEGER NOT NULL DEFAULT 0,
  "caCents"          INTEGER NOT NULL DEFAULT 0,
  "devise"           TEXT NOT NULL DEFAULT '',
  "consentement"     TEXT NOT NULL DEFAULT 'inconnu',
  CONSTRAINT "LinaClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinaClient_userId_source_ref_key" ON "LinaClient" ("userId", "source", "ref");
CREATE INDEX "LinaClient_userId_derniereCommande_idx" ON "LinaClient" ("userId", "derniereCommande");
ALTER TABLE "LinaClient" ADD CONSTRAINT "LinaClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LinaSynchro" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "etat"         TEXT NOT NULL DEFAULT 'jamais',
  "message"      TEXT NOT NULL DEFAULT '',
  "source"       TEXT NOT NULL DEFAULT 'shopify',
  "operation"    TEXT,
  "lanceAt"      TIMESTAMP(3),
  "synchroAt"    TIMESTAMP(3),
  "essaiAt"      TIMESTAMP(3),
  "clients"      INTEGER NOT NULL DEFAULT 0,
  "tronque"      BOOLEAN NOT NULL DEFAULT false,
  "consentement" BOOLEAN NOT NULL DEFAULT false,
  "paniers"      JSONB NOT NULL DEFAULT '{}',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinaSynchro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinaSynchro_userId_key" ON "LinaSynchro" ("userId");
ALTER TABLE "LinaSynchro" ADD CONSTRAINT "LinaSynchro_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LinaReglages" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "criteres"  JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinaReglages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinaReglages_userId_key" ON "LinaReglages" ("userId");
ALTER TABLE "LinaReglages" ADD CONSTRAINT "LinaReglages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LinaClient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaClient" FORCE ROW LEVEL SECURITY;
CREATE POLICY linaclient_owner ON "LinaClient" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "LinaSynchro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaSynchro" FORCE ROW LEVEL SECURITY;
CREATE POLICY linasynchro_owner ON "LinaSynchro" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "LinaReglages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaReglages" FORCE ROW LEVEL SECURITY;
CREATE POLICY linareglages_owner ON "LinaReglages" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaClient" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaSynchro" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaReglages" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
