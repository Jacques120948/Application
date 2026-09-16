-- Mode plan : annoncer une modification qui engage avant de l'appliquer.
--
-- Trois colonnes facultatives sur les messages existants : un message d'hier n'a pas de
-- plan, et se relit exactement comme avant.

CREATE TYPE "PlanStatus" AS ENUM ('PROPOSED', 'APPLIED', 'CANCELLED', 'STALE');

ALTER TABLE "ChatMessage"
  ADD COLUMN "plan" JSONB,
  ADD COLUMN "planStatus" "PlanStatus",
  ADD COLUMN "planBase" TEXT;

-- Retrouver la proposition en attente d'un projet doit rester immédiat : c'est fait à
-- chaque ouverture de la conversation.
CREATE INDEX "ChatMessage_projectId_planStatus_idx" ON "ChatMessage"("projectId", "planStatus");
