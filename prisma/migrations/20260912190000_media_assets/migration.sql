-- Images des applications générées.
--
-- Stockées en base plutôt que chez un hébergeur de fichiers. Ce n'est pas l'usage le plus
-- courant, et c'est un choix assumé : pas de fournisseur de plus, pas de secret de plus,
-- pas de facture de plus, et l'image hérite du cloisonnement déjà appliqué au reste. Le
-- volume est borné par le quota de l'offre — c'est la condition pour que mille créateurs
-- ne se traduisent pas par une dépense imprévisible.

CREATE TABLE "MediaAsset" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "filename"  TEXT NOT NULL,
  "mime"      TEXT NOT NULL,
  "width"     INTEGER NOT NULL,
  "height"    INTEGER NOT NULL,
  "bytes"     INTEGER NOT NULL,
  "data"      BYTEA NOT NULL,
  "thumb"     BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaAsset_projectId_createdAt_idx" ON "MediaAsset" ("projectId", "createdAt");
CREATE INDEX "MediaAsset_userId_idx" ON "MediaAsset" ("userId");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Espace autorisé par offre. Zéro par défaut : une offre n'ouvre rien qu'on ne lui ait
-- accordé, et l'offre de découverte ne construit pas d'application.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "storageBytes" INTEGER NOT NULL DEFAULT 0;

UPDATE "Plan" SET "storageBytes" =  50 * 1024 * 1024 WHERE "id" = 'launch'   AND "storageBytes" = 0;
UPDATE "Plan" SET "storageBytes" = 250 * 1024 * 1024 WHERE "id" = 'builder'  AND "storageBytes" = 0;
UPDATE "Plan" SET "storageBytes" = 1024 * 1024 * 1024 WHERE "id" = 'business' AND "storageBytes" = 0;

-- ─────────────────────────── Cloisonnement ────────────────────────────────
ALTER TABLE "MediaAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaAsset" FORCE ROW LEVEL SECURITY;
CREATE POLICY mediaasset_owner ON "MediaAsset" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

/*
 * Les images d'une application publiée sont lues par ses visiteurs, qui ne sont pas le
 * créateur. La lecture passe donc aussi par la portée d'exécution, celle qui sert déjà les
 * données des applications en ligne, et seulement pour le projet concerné.
 */
CREATE POLICY mediaasset_runtime ON "MediaAsset" FOR SELECT
  USING ("projectId" = app_current_project_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MediaAsset" TO appforge_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MediaAsset" TO evoliia_app;
  END IF;
END
$$;
