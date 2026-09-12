-- Kit de lancement marketing.
--
-- Le moteur social qui le produit est sans état : il ne conserve rien de ce qu'il reçoit ni
-- de ce qu'il renvoie. La seule copie du travail du créateur vit donc ici, et suit la même
-- règle que le reste de ses données : sa base, son cloisonnement, sa suppression en cascade.

CREATE TABLE "MarketingKit" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL,
  "projectId"     UUID NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "content"       JSONB NOT NULL,
  "model"         TEXT NOT NULL,
  "inputTokens"   INTEGER NOT NULL DEFAULT 0,
  "outputTokens"  INTEGER NOT NULL DEFAULT 0,
  "cachedTokens"  INTEGER NOT NULL DEFAULT 0,
  "costMicros"    INTEGER NOT NULL DEFAULT 0,
  "creditsSpent"  INTEGER NOT NULL DEFAULT 0,
  "approvedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingKit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingKit_projectId_createdAt_idx" ON "MarketingKit" ("projectId", "createdAt");
CREATE INDEX "MarketingKit_userId_createdAt_idx" ON "MarketingKit" ("userId", "createdAt");

ALTER TABLE "MarketingKit"
  ADD CONSTRAINT "MarketingKit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingKit"
  ADD CONSTRAINT "MarketingKit_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Cloisonnement ────────────────────────────────
ALTER TABLE "MarketingKit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingKit" FORCE ROW LEVEL SECURITY;
CREATE POLICY marketingkit_owner ON "MarketingKit" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MarketingKit" TO appforge_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MarketingKit" TO evoliia_app;
  END IF;
END
$$;
