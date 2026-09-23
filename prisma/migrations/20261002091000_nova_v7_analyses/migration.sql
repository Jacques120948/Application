-- Nova V7 : les écrits demandés à Nova (synthèse, analyse approfondie), pour les relire sans repayer.
CREATE TABLE "NovaAnalyse" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "genre"        TEXT NOT NULL,
  "periode"      TEXT NOT NULL,
  "du"           DATE NOT NULL,
  "au"           DATE NOT NULL,
  "contenu"      JSONB NOT NULL,
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NovaAnalyse_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NovaAnalyse_userId_genre_createdAt_idx" ON "NovaAnalyse" ("userId", "genre", "createdAt" DESC);
ALTER TABLE "NovaAnalyse"
  ADD CONSTRAINT "NovaAnalyse_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NovaAnalyse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NovaAnalyse" FORCE ROW LEVEL SECURITY;
CREATE POLICY novaanalyse_owner ON "NovaAnalyse" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "NovaAnalyse" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
