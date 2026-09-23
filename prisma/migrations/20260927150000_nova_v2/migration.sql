-- Nova V2 : le premier contact, la valeur des nouveaux clients, et les réglages.

-- Le chiffre des premières commandes : c'est ce qui sépare nouveaux et fidèles.
ALTER TABLE "CommerceJour" ADD COLUMN "chiffreNouveauxCents" BIGINT NOT NULL DEFAULT 0;
-- Les canaux au premier clic (première visite enregistrée), à côté du dernier clic.
ALTER TABLE "CommerceJour" ADD COLUMN "canauxPremier" JSONB NOT NULL DEFAULT '{}';

-- L'instantané des clients sur la fenêtre lue : combien de clients distincts, combien
-- revenus, ce qu'ils ont rapporté. Des comptes, jamais un identifiant.
ALTER TABLE "CommerceSynchro" ADD COLUMN "clients" JSONB NOT NULL DEFAULT '{}';

-- Ce que la personne dit de son activité : son type, ses objectifs, ses coûts. C'est elle
-- qui les saisit ; Nova ne les devine pas.
CREATE TABLE "NovaReglages" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "activite"  TEXT NOT NULL DEFAULT '',
  "objectifs" JSONB NOT NULL DEFAULT '{}',
  "couts"     JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NovaReglages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NovaReglages_userId_key" ON "NovaReglages" ("userId");

ALTER TABLE "NovaReglages"
  ADD CONSTRAINT "NovaReglages_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NovaReglages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NovaReglages" FORCE ROW LEVEL SECURITY;
CREATE POLICY novareglages_owner ON "NovaReglages" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "NovaReglages" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
