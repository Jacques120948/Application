-- Tarifs administrables, réservation de crédits, ledger typé.
--
-- Rien n'est retiré : les colonnes ajoutées sont facultatives ou ont une valeur par
-- défaut qui reproduit le comportement actuel. Une installation qui ne toucherait à rien
-- se comporte exactement comme avant la migration.

CREATE TYPE "CreditMovement" AS ENUM (
  'SUBSCRIPTION_CREDIT',
  'CREDIT_PURCHASE',
  'AI_USAGE',
  'REFUND',
  'ADJUSTMENT',
  'BONUS',
  'EXPIRED_CREDIT'
);

ALTER TABLE "CreditLedger"
  ADD COLUMN "type" "CreditMovement" NOT NULL DEFAULT 'ADJUSTMENT',
  ADD COLUMN "aiUsageId" UUID,
  ADD COLUMN "stripePaymentId" TEXT;

-- Les mouvements déjà écrits portent leur motif en clair : on le relit une fois pour
-- leur donner le type qui leur revient, plutôt que de laisser tout l'historique en
-- « correction manuelle ».
UPDATE "CreditLedger" SET "type" = 'AI_USAGE' WHERE "reason" LIKE 'ia:%';
UPDATE "CreditLedger" SET "type" = 'SUBSCRIPTION_CREDIT' WHERE "reason" LIKE 'grant:%';

CREATE UNIQUE INDEX "CreditLedger_stripePaymentId_key" ON "CreditLedger"("stripePaymentId");
CREATE INDEX "CreditLedger_type_createdAt_idx" ON "CreditLedger"("type", "createdAt");

ALTER TABLE "CreditLedger"
  ADD CONSTRAINT "CreditLedger_aiUsageId_fkey"
  FOREIGN KEY ("aiUsageId") REFERENCES "AiUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CreditReservation" (
  "id"         UUID NOT NULL,
  "userId"     UUID NOT NULL,
  "projectId"  UUID,
  "operation"  TEXT NOT NULL,
  "amount"     INTEGER NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreditReservation_userId_releasedAt_idx" ON "CreditReservation"("userId", "releasedAt");
CREATE INDEX "CreditReservation_expiresAt_idx" ON "CreditReservation"("expiresAt");

ALTER TABLE "CreditReservation"
  ADD CONSTRAINT "CreditReservation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiModelPricing" (
  "model"                 TEXT NOT NULL,
  "label"                 TEXT NOT NULL,
  "inputCentsPerMTok"     INTEGER NOT NULL,
  "outputCentsPerMTok"    INTEGER NOT NULL,
  "cacheReadCentsPerMTok" INTEGER NOT NULL,
  "isActive"              BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiModelPricing_pkey" PRIMARY KEY ("model")
);
