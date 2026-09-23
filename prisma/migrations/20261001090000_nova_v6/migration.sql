-- Nova V6 : audiences et événements clés de GA4, par jour. Des totaux : aucun visiteur.
ALTER TABLE "AnalyticsJour"
  ADD COLUMN IF NOT EXISTS "pays" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "visiteurs" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "evenements" JSONB NOT NULL DEFAULT '{}';
