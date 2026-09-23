-- Les jours GA4 portent désormais l'engagement par page : la version dit quand tout relire.
ALTER TABLE "AnalyticsSynchro" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
