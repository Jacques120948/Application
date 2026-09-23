-- Nova V5 : les abonnements Stripe, réduits à des chiffres. Aucun client, aucun identifiant :
-- le MRR, le nombre d'abonnés, leur série mensuelle et les cohortes par mois de départ.
CREATE TABLE "AbonnementsSynchro" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "etat"       TEXT NOT NULL DEFAULT 'jamais',
  "message"    TEXT NOT NULL DEFAULT '',
  "synchroAt"  TIMESTAMP(3),
  "essaiAt"    TIMESTAMP(3),
  "devise"     TEXT NOT NULL DEFAULT '',
  "tronque"    BOOLEAN NOT NULL DEFAULT false,
  "instantane" JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AbonnementsSynchro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AbonnementsSynchro_userId_key" ON "AbonnementsSynchro" ("userId");
ALTER TABLE "AbonnementsSynchro"
  ADD CONSTRAINT "AbonnementsSynchro_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AbonnementsSynchro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AbonnementsSynchro" FORCE ROW LEVEL SECURITY;
CREATE POLICY abonnementssynchro_owner ON "AbonnementsSynchro" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AbonnementsSynchro" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
