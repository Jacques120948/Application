-- Lina V4 : autonomie (conseil / assisté), journal des actions exécutées, alertes notifiées.
ALTER TABLE "LinaReglages" ADD COLUMN IF NOT EXISTS "autonomie" TEXT NOT NULL DEFAULT 'assiste';
ALTER TABLE "LinaSynchro" ADD COLUMN IF NOT EXISTS "alertesVues" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "LinaAction" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "type"       TEXT NOT NULL,
  "cle"        TEXT NOT NULL,
  "nom"        TEXT NOT NULL,
  "refExterne" TEXT NOT NULL DEFAULT '',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinaAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LinaAction_userId_createdAt_idx" ON "LinaAction" ("userId", "createdAt");
ALTER TABLE "LinaAction" ADD CONSTRAINT "LinaAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LinaAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinaAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY linaaction_owner ON "LinaAction" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LinaAction" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
