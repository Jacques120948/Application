-- Lina : le bilan de la semaine par e-mail, sur demande (désactivé par défaut).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "linaBilanEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "linaBilanEnvoyeLe" DATE;
