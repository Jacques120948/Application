-- Stripe : abonnements Evoliia et encaissement dans les applications créées.
-- Rien n'est supprimé ; tout est ajouté avec une valeur par défaut.

-- ─────────────────────────── Offres et abonnements ───────────────────────────
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "stripeProductId" TEXT;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "stripePriceId" TEXT;
-- Prix, monnaie et période au moment où le tarif Stripe a été créé. S'ils changent, un
-- nouveau tarif est créé ; l'ancien est archivé et les abonnés en cours le gardent.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "stripePriceFingerprint" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User" ("stripeCustomerId");

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Subscription_stripeSubscriptionId_idx" ON "Subscription" ("stripeSubscriptionId");

-- ─────────────────────────── Événements reçus ───────────────────────────────
-- Un événement Stripe peut être livré plusieurs fois : son identifiant est retenu pour
-- ne le traiter qu'une seule fois. Table globale, sans locataire.
CREATE TABLE IF NOT EXISTS "StripeEvent" (
  "id"         TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "account"    TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- ───────────────── Achats des utilisateurs d'une application ────────────────
CREATE TABLE IF NOT EXISTS "AppPurchase" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId"            UUID NOT NULL,
  "endUserId"            UUID,
  "planId"               TEXT NOT NULL,
  "planName"             TEXT NOT NULL,
  "mode"                 TEXT NOT NULL,
  "amountCents"          INTEGER NOT NULL DEFAULT 0,
  "currency"             TEXT NOT NULL,
  "status"               TEXT NOT NULL DEFAULT 'paid',
  "stripeAccountId"      TEXT NOT NULL,
  "stripeSessionId"      TEXT NOT NULL,
  "stripeSubscriptionId" TEXT,
  "currentPeriodEnd"     TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppPurchase_stripeSessionId_key" ON "AppPurchase" ("stripeSessionId");
CREATE INDEX IF NOT EXISTS "AppPurchase_projectId_status_createdAt_idx" ON "AppPurchase" ("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AppPurchase_endUserId_idx" ON "AppPurchase" ("endUserId");
CREATE INDEX IF NOT EXISTS "AppPurchase_stripeSubscriptionId_idx" ON "AppPurchase" ("stripeSubscriptionId");
ALTER TABLE "AppPurchase" ADD CONSTRAINT "AppPurchase_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppPurchase" ADD CONSTRAINT "AppPurchase_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "AppEndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Même politique que les autres tables rattachées à un projet : le propriétaire du projet,
-- ou l'application servie dans cette transaction.
ALTER TABLE "AppPurchase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppPurchase" FORCE ROW LEVEL SECURITY;
CREATE POLICY apppurchase_scope ON "AppPurchase" FOR ALL
  USING (
    "projectId" = app_current_project_id()
    OR EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "AppPurchase"."projectId" AND p."ownerId" = app_current_user_id())
  )
  WITH CHECK (
    "projectId" = app_current_project_id()
    OR EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "AppPurchase"."projectId" AND p."ownerId" = app_current_user_id())
  );

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['StripeEvent', 'AppPurchase'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appforge_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO evoliia_app', t);
    END IF;
  END LOOP;
END
$$;
