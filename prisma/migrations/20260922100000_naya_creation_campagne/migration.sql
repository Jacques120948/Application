-- Ce qu'une campagne contiendra, écrit avant qu'un seul appel parte chez Google.
--
-- Une table, et non un objet renvoyé au navigateur puis renvoyé au serveur. La différence
-- est une garantie : ce que la personne confirme à l'écran est exactement ce qui existe ici,
-- et le navigateur ne transmet qu'un identifiant. Faire circuler le plan par le navigateur
-- reviendrait à croire sur parole les textes, les mots-clés et le budget au moment de créer
-- — c'est-à-dire à laisser n'importe quelle page modifiée créer la campagne de son choix.
--
-- C'est aussi ce qui rend la création honnête. Une campagne est faite de six objets chez
-- Google : un budget, la campagne, son ciblage géographique, sa langue, un groupe
-- d'annonces, ses mots-clés et une annonce. Les montrer d'avance, tous, permet de dire
-- « voici ce qui va être créé » sans rien passer sous silence.

CREATE TABLE "AdsPlanCampagne" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "accountId" UUID NOT NULL,

  "nom"          TEXT NOT NULL,
  -- Le budget quotidien, en micros de la devise du compte.
  "budgetMicros" BIGINT NOT NULL DEFAULT 0,
  -- L'enchère par clic du groupe d'annonces. Manuelle, et c'est un choix : une stratégie
  -- automatique sur une campagne sans historique de conversion dépense pour apprendre.
  "enchereMicros" BIGINT NOT NULL DEFAULT 0,
  -- La page où les gens arriveront. Vérifiée contre les domaines de la personne, jamais crue.
  "urlFinale"    TEXT NOT NULL,

  -- Le marché et la langue, dans le vocabulaire de Google, plus leur nom lisible.
  "marcheGeo"  TEXT NOT NULL DEFAULT '',
  "marcheNom"  TEXT NOT NULL DEFAULT '',
  "langueCode" TEXT NOT NULL DEFAULT '',
  "langueNom"  TEXT NOT NULL DEFAULT '',

  -- Les mots-clés retenus, avec leurs chiffres au moment du plan.
  "motsCles"     JSONB NOT NULL DEFAULT '[]',
  -- Les textes de l'annonce. Google exige au moins trois titres et deux descriptions ; en
  -- dessous, il refuse l'annonce et le groupe reste sans rien à diffuser.
  "titres"       JSONB NOT NULL DEFAULT '[]',
  "descriptions" JSONB NOT NULL DEFAULT '[]',

  -- prepare | cree | abandonne
  "etat" TEXT NOT NULL DEFAULT 'prepare',
  -- Ce que Google a rendu à la création : de quoi retrouver et supprimer la campagne.
  "campagneRessource" TEXT NOT NULL DEFAULT '',
  "budgetRessource"   TEXT NOT NULL DEFAULT '',

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"  TIMESTAMP(3),

  CONSTRAINT "AdsPlanCampagne_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdsPlanCampagne_accountId_etat_idx" ON "AdsPlanCampagne" ("accountId", "etat");

ALTER TABLE "AdsPlanCampagne" ADD CONSTRAINT "AdsPlanCampagne_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsPlanCampagne" ADD CONSTRAINT "AdsPlanCampagne_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdsPlanCampagne" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsPlanCampagne" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsplancampagne_owner ON "AdsPlanCampagne" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsPlanCampagne" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
