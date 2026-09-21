-- Ce que Naya propose d'ajouter à une annonce.
--
-- Une table séparée des éléments réels, et c'est la seule décision de ce fichier. Ranger une
-- proposition parmi les titres existants ferait compter « 12 titres sur 15 » à une annonce
-- qui n'en a que neuf : la personne croirait son travail fait, et Google continuerait de lui
-- donner moins de place. Ce qui est chez Google et ce qu'on voudrait y mettre sont deux
-- choses, et l'écran doit pouvoir les montrer côte à côte sans les confondre.
--
-- Les propositions ne sont pas effacées par le balayage hebdomadaire du créatif : elles ne
-- viennent pas de Google, elles n'ont pas à disparaître parce que Google ne les connaît pas.

CREATE TABLE "AdsProposition" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "groupeId"  UUID NOT NULL,

  -- titre | titre-long | description : les mêmes champs que les éléments réels.
  "champ"     TEXT NOT NULL,
  "texte"     TEXT NOT NULL,
  -- Sur quoi elle s'appuie : une recherche réelle, un produit, un manque constaté. C'est ce
  -- qui rend la proposition discutable plutôt qu'à prendre ou à laisser.
  "motif"     TEXT NOT NULL DEFAULT '',
  -- proposee | deposee | ecartee
  "etat"      TEXT NOT NULL DEFAULT 'proposee',

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"  TIMESTAMP(3),

  CONSTRAINT "AdsProposition_pkey" PRIMARY KEY ("id")
);

-- Le même texte proposé deux fois pour un même champ n'apporte rien : Google refuse de
-- toute façon les doublons dans un contenant.
CREATE UNIQUE INDEX "AdsProposition_groupeId_champ_texte_key"
  ON "AdsProposition" ("groupeId", "champ", "texte");
CREATE INDEX "AdsProposition_groupeId_etat_idx" ON "AdsProposition" ("groupeId", "etat");

ALTER TABLE "AdsProposition" ADD CONSTRAINT "AdsProposition_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsProposition" ADD CONSTRAINT "AdsProposition_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsProposition" ADD CONSTRAINT "AdsProposition_groupeId_fkey"
  FOREIGN KEY ("groupeId") REFERENCES "AdsGroupe" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdsProposition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsProposition" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsproposition_owner ON "AdsProposition" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsProposition" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
