-- Remboursements des ventes faites dans les applications créées.
ALTER TABLE "AppPurchase"
  ADD COLUMN "stripePaymentIntentId" TEXT,
  ADD COLUMN "applicationFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundedAt" TIMESTAMP(3);

CREATE INDEX "AppPurchase_stripePaymentIntentId_idx" ON "AppPurchase"("stripePaymentIntentId");
