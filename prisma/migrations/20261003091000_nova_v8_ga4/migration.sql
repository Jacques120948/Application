-- Âge et sexe des visiteurs, par jour, quand les signaux Google les donnent. Des totaux, aucun visiteur.
ALTER TABLE "AnalyticsJour" ADD COLUMN IF NOT EXISTS "demographie" JSONB NOT NULL DEFAULT '{}';
