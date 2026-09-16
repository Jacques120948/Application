-- Alertes au créateur : quota par offre, et trace de ce qui a été envoyé ou retenu.
--
-- Le quota vaut zéro par défaut sur toutes les offres : la fonction reste fermée tant que
-- l'exploitant ne l'ouvre pas, offre par offre, depuis le back-office. Aucune installation
-- existante ne se met donc à envoyer des courriels du seul fait de cette migration.

ALTER TABLE "Plan" ADD COLUMN "alertsPerMonth" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "OwnerAlert" (
  "id"        UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "modelId"   TEXT NOT NULL,
  "recordId"  UUID NOT NULL,
  "sent"      BOOLEAN NOT NULL DEFAULT true,
  "reason"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerAlert_pkey" PRIMARY KEY ("id")
);

-- Le quota mensuel se lit par créateur, le plafond journalier par application.
CREATE INDEX "OwnerAlert_userId_createdAt_idx" ON "OwnerAlert"("userId", "createdAt");
CREATE INDEX "OwnerAlert_projectId_createdAt_idx" ON "OwnerAlert"("projectId", "createdAt");

ALTER TABLE "OwnerAlert"
  ADD CONSTRAINT "OwnerAlert_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OwnerAlert"
  ADD CONSTRAINT "OwnerAlert_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
