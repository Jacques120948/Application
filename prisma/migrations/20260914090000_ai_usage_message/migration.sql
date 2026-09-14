-- Diagnostic : le message d'erreur du fournisseur, pour comprendre un appel IA en échec
-- depuis le back-office plutôt que depuis les journaux de l'hébergeur.
ALTER TABLE "AiUsage" ADD COLUMN "errorMessage" TEXT;
CREATE INDEX "AiUsage_success_createdAt_idx" ON "AiUsage"("success", "createdAt");
