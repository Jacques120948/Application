-- Les ventes d'une boutique, jour par jour, pour Nova.
--
-- Agrégées, jamais détaillées : un total, un nombre de commandes, de nouveaux clients, et
-- la répartition par canal et par produit. Aucun nom, aucune adresse, aucun courriel de
-- client n'est conservé — Nova compte des ventes, elle ne tient pas de fichier clients.
--
-- Gardées plutôt que relues : ouvrir Nova ne rappelle pas Shopify. Une synchronisation
-- écrit ces lignes, l'écran les relit gratuitement autant de fois qu'on veut.
CREATE TABLE "CommerceJour" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"            UUID NOT NULL,
  "source"            TEXT NOT NULL,
  "boutique"          TEXT NOT NULL,
  "jour"              DATE NOT NULL,
  "devise"            TEXT NOT NULL DEFAULT '',
  "commandes"         INTEGER NOT NULL DEFAULT 0,
  "chiffreCents"      BIGINT NOT NULL DEFAULT 0,
  "nouveauxClients"   INTEGER NOT NULL DEFAULT 0,
  "clientsIdentifies" INTEGER NOT NULL DEFAULT 0,
  "canaux"            JSONB NOT NULL DEFAULT '{}',
  "produits"          JSONB NOT NULL DEFAULT '[]',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceJour_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceJour_userId_source_boutique_jour_key"
  ON "CommerceJour" ("userId", "source", "boutique", "jour");
CREATE INDEX "CommerceJour_userId_jour_idx" ON "CommerceJour" ("userId", "jour" DESC);

ALTER TABLE "CommerceJour"
  ADD CONSTRAINT "CommerceJour_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- L'état de la dernière synchronisation d'une source de ventes : quand, jusqu'où, et ce
-- qui a échoué. C'est ce qui permet d'écrire « les dernières données datent de… » au lieu
-- d'un écran vide quand la source ne répond plus.
CREATE TABLE "CommerceSynchro" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL,
  "source"           TEXT NOT NULL,
  "boutique"         TEXT NOT NULL,
  "etat"             TEXT NOT NULL DEFAULT 'jamais',
  "message"          TEXT NOT NULL DEFAULT '',
  "synchroAt"        TIMESTAMP(3),
  "essaiAt"          TIMESTAMP(3),
  "couvertureDepuis" DATE,
  "tronque"          BOOLEAN NOT NULL DEFAULT false,
  "devise"           TEXT NOT NULL DEFAULT '',
  "fuseau"           TEXT NOT NULL DEFAULT '',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceSynchro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceSynchro_userId_source_boutique_key"
  ON "CommerceSynchro" ("userId", "source", "boutique");

ALTER TABLE "CommerceSynchro"
  ADD CONSTRAINT "CommerceSynchro_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolées comme les autres : chacun ne lit et n'écrit que ses propres ventes.
ALTER TABLE "CommerceJour" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommerceJour" FORCE ROW LEVEL SECURITY;
CREATE POLICY commercejour_owner ON "CommerceJour" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "CommerceSynchro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommerceSynchro" FORCE ROW LEVEL SECURITY;
CREATE POLICY commercesynchro_owner ON "CommerceSynchro" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CommerceJour" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CommerceSynchro" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
