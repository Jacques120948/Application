-- Réinitialisation du mot de passe d'un visiteur d'application.
--
-- Une table à part plutôt qu'une réutilisation de « VerificationToken » : celle-là est
-- rattachée aux comptes d'Evoliia, celle-ci aux visiteurs d'une application. Les mêler
-- ferait de la colonne « userId » une chose qui désigne tantôt l'un, tantôt l'autre.
--
-- Le jeton n'est jamais stocké en clair : seule une empreinte, comme les jetons de session.

CREATE TABLE "AppEndUserToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "endUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppEndUserToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppEndUserToken_tokenHash_key" ON "AppEndUserToken"("tokenHash");
CREATE INDEX "AppEndUserToken_endUserId_idx" ON "AppEndUserToken"("endUserId");
CREATE INDEX "AppEndUserToken_projectId_expiresAt_idx" ON "AppEndUserToken"("projectId", "expiresAt");

ALTER TABLE "AppEndUserToken"
  ADD CONSTRAINT "AppEndUserToken_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "AppEndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppEndUserToken"
  ADD CONSTRAINT "AppEndUserToken_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Même cloisonnement que les autres tables d'un projet : la base refuse elle-même une
-- lecture ou une écriture hors de la portée ouverte pour la transaction.
ALTER TABLE "AppEndUserToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppEndUserToken" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appendusertoken_scope" ON "AppEndUserToken" FOR ALL
  USING (
    "projectId" = app_current_project_id()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p."id" = "AppEndUserToken"."projectId" AND p."ownerId" = app_current_user_id()
    )
  )
  WITH CHECK (
    "projectId" = app_current_project_id()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p."id" = "AppEndUserToken"."projectId" AND p."ownerId" = app_current_user_id()
    )
  );
