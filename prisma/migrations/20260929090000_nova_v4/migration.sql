-- Nova V4 : le coût réel des produits, lu dans Shopify, pour une marge qui ne dépend plus
-- d'un pourcentage saisi. Des totaux par jour, rien de plus ; les tables restent sous RLS.
ALTER TABLE "CommerceJour"
  ADD COLUMN "coutsLus" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lignesCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "lignesCouteesCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "coutProduitsCents" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "CommerceSynchro"
  ADD COLUMN "coutsAt" TIMESTAMP(3),
  ADD COLUMN "coutsMessage" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "coutsVariantes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "coutsRenseignes" INTEGER NOT NULL DEFAULT 0;
