-- Lina V2 : ce que les commandes apprennent, en totaux ; et les résultats de campagnes saisis.
ALTER TABLE "LinaClient" ADD COLUMN IF NOT EXISTS "premiereCommande" TIMESTAMP(3);
ALTER TABLE "LinaClient" ADD COLUMN IF NOT EXISTS "intervalleJours" INTEGER;
ALTER TABLE "LinaClient" ADD COLUMN IF NOT EXISTS "produitPrincipal" TEXT;

ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "analyse" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "commandesAt" TIMESTAMP(3);
ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "commandesMessage" TEXT NOT NULL DEFAULT '';

CREATE TABLE "LinaProduit" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL,
  "ref"              TEXT NOT NULL,
  "titre"            TEXT NOT NULL,
  "type"             TEXT NOT NULL DEFAULT '',
  "acheteurs"        INTEGER NOT NULL DEFAULT 0,
  "reacheteurs"      INTEGER NOT NULL DEFAULT 0,
  "commandes"        INTEGER NOT NULL DEFAULT 0,
  "caCents"          INTEGER NOT NULL DEFAULT 0,
  "prixMoyenCents"   INTEGER NOT NULL DEFAULT 0,
  "intervalleMedian" INTEGER,
  "intervalleP25"    INTEGER,
  "intervalleP75"    INTEGER,
  CONSTRAINT "LinaProduit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinaProduit_userId_ref_key" ON "LinaProduit" ("userId", "ref");
ALTER TABLE "LinaProduit" ADD CONSTRAINT "LinaProduit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LinaResultat" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"          UUID NOT NULL,
  "nom"             TEXT NOT NULL,
  "type"            TEXT NOT NULL DEFAULT 'autre',
  "groupe"          TEXT NOT NULL DEFAULT '',
  "variante"        TEXT NOT NULL DEFAULT '',
  "envoyeLe"        DATE,
  "envoyes"         INTEGER NOT NULL,
  "ouvertures"      INTEGER,
  "clics"           INTEGER,
  "conversions"     INTEGER NOT NULL DEFAULT 0,
  "caCents"         INTEGER NOT NULL DEFAULT 0,
  "desinscriptions" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinaResultat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LinaResultat_userId_createdAt_idx" ON "LinaResultat" ("userId", "createdAt");
ALTER TABLE "LinaResultat" ADD CONSTRAINT "LinaResultat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LinaProduit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaProduit" FORCE ROW LEVEL SECURITY;
CREATE POLICY linaproduit_owner ON "LinaProduit" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "LinaResultat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaResultat" FORCE ROW LEVEL SECURITY;
CREATE POLICY linaresultat_owner ON "LinaResultat" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaProduit" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaResultat" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
