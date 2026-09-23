-- Lina V3 : résultats relus depuis les outils d'emailing, relevés hebdomadaires, objectifs.
ALTER TABLE "LinaResultat" ALTER COLUMN "conversions" DROP NOT NULL;
ALTER TABLE "LinaResultat" ALTER COLUMN "conversions" DROP DEFAULT;
ALTER TABLE "LinaResultat" ALTER COLUMN "caCents" DROP NOT NULL;
ALTER TABLE "LinaResultat" ALTER COLUMN "caCents" DROP DEFAULT;
ALTER TABLE "LinaResultat" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE "LinaResultat" ADD COLUMN IF NOT EXISTS "refExterne" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "LinaResultat_userId_source_refExterne_key" ON "LinaResultat" ("userId", "source", "refExterne");

ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "emailingAt" TIMESTAMP(3);
ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "emailingMessage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinaReglages" ADD COLUMN IF NOT EXISTS "objectifs" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "LinaReleve" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "semaine"   DATE NOT NULL,
  "donnees"   JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinaReleve_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinaReleve_userId_semaine_key" ON "LinaReleve" ("userId", "semaine");
ALTER TABLE "LinaReleve" ADD CONSTRAINT "LinaReleve_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LinaReleve" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaReleve" FORCE ROW LEVEL SECURITY;
CREATE POLICY linareleve_owner ON "LinaReleve" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaReleve" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
