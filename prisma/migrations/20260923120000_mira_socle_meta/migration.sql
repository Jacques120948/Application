-- Le socle publicitaire s'ouvre à Meta, sans se dédoubler.
--
-- Naya a été écrite derrière une frontière de plateforme, et c'était délibéré : « Un budget
-- quotidien chez Google est un objet partagé entre campagnes ; chez Meta il appartient à
-- l'ensemble de publicités » (src/server/ads/provider.ts). La colonne `plateforme` de
-- AdsAccount porte depuis le premier jour la mention « Meta et Microsoft s'y rangeront ».
-- Cette migration tient cette promesse plutôt que d'ouvrir une seconde pile à côté.
--
-- Pourquoi ne PAS créer meta_campaigns, meta_recommendations, meta_actions : ces tables
-- existent déjà sous un nom neutre. Les dupliquer dédoublerait du même coup le moteur de
-- règles et le journal d'audit — et le jour où l'un des deux gagnerait une borne que
-- l'autre n'a pas, un agent aurait le droit de faire ce que l'autre s'interdit, sans que
-- rien ne le signale. C'est précisément l'accident que la frontière existait pour empêcher.
--
-- Quatre ajouts, et rien de plus.

-- 1. Les relevés descendent à trois niveaux.
--
-- Meta se lit en campagne, ensemble de publicités et annonce ; Google s'arrêtait à la
-- campagne. Deux colonnes de plus valent mieux qu'une table par niveau : ce sont les mêmes
-- chiffres, au même rythme, et trois tables auraient donné trois façons de calculer un CPA.
--
-- Chaîne vide plutôt que NULL, et c'est la précaution qui compte : Postgres tient deux NULL
-- pour distincts dans un index unique. Avec NULL, deux relevés de campagne du même jour
-- auraient pu coexister, et le doublon se serait vu des semaines plus tard, dans une
-- dépense comptée deux fois.
ALTER TABLE "AdsReleve"
  ADD COLUMN "groupeId"  TEXT NOT NULL DEFAULT '',
  ADD COLUMN "annonceId" TEXT NOT NULL DEFAULT '',
  -- Le nombre de personnes distinctes atteintes. Meta le donne, Google non : 0 veut donc
  -- dire « la plateforme ne le dit pas », et l'écran se tait plutôt que d'afficher zéro.
  -- La fréquence s'en déduit (impressions / portée) et n'est pas stockée : une valeur
  -- dérivée conservée est une valeur qui finit par contredire celles dont elle vient.
  ADD COLUMN "portee"    BIGINT NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "AdsReleve_campagneId_jour_key";
CREATE UNIQUE INDEX "AdsReleve_campagneId_groupeId_annonceId_jour_key"
  ON "AdsReleve" ("campagneId", "groupeId", "annonceId", "jour");
-- Les lignes de campagne restent lisibles seules : sans ceci, chaque total de compte
-- balaierait aussi les ensembles et les annonces, et compterait la même dépense trois fois.
CREATE INDEX "AdsReleve_campagne_seule_idx"
  ON "AdsReleve" ("accountId", "jour" DESC)
  WHERE "groupeId" = '' AND "annonceId" = '';

-- 2. Le budget descend sur le contenant.
--
-- Chez Google le budget est un objet séparé, partagé entre campagnes, et c'est pourquoi une
-- hausse y est refusée quand il sert à plusieurs. Chez Meta il vit sur l'ensemble de
-- publicités — sauf quand la campagne le pilote (budget au niveau campagne). Les deux cas
-- existent chez le même annonceur : la colonne dit où il est réellement, et 0 veut dire
-- « pas ici », donc « ne touchez pas à ce niveau ».
ALTER TABLE "AdsGroupe"
  ADD COLUMN "budgetMicros" BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN "budgetId"     TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "budgetLimite" BOOLEAN NOT NULL DEFAULT false;

-- 3. L'annonce devient un objet.
--
-- Chez Google, une annonce responsive est une collection de morceaux, et AdsElement les
-- porte déjà. Chez Meta, l'annonce est une chose : un visuel, un texte, un identifiant, des
-- chiffres à elle. Sans cette table, l'onglet Créatives n'aurait rien à afficher et MIRA ne
-- saurait pas dire « cette publicité-ci consomme sans vendre ».
CREATE TABLE "AdsAnnonce" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "groupeId"  UUID NOT NULL,

  -- L'identifiant chez la plateforme : c'est lui qu'on renvoie pour mettre en pause.
  "annonceId" TEXT NOT NULL,
  "nom"       TEXT NOT NULL DEFAULT '',
  -- ACTIVE | PAUSED | ARCHIVED… le vocabulaire de la plateforme, repris tel quel.
  "statut"    TEXT NOT NULL DEFAULT '',
  -- IMAGE | VIDEO | CAROUSEL… vide quand la plateforme ne le dit pas.
  "format"    TEXT NOT NULL DEFAULT '',
  -- L'adresse de l'aperçu chez la plateforme. Jamais l'image elle-même : la recopier ferait
  -- d'Evoliia un hébergeur de créatives, avec la durée de conservation que cela suppose.
  "apercu"    TEXT NOT NULL DEFAULT '',

  "vueAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsAnnonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsAnnonce_accountId_annonceId_key"
  ON "AdsAnnonce" ("accountId", "annonceId");
CREATE INDEX "AdsAnnonce_groupeId_idx" ON "AdsAnnonce" ("groupeId");

ALTER TABLE "AdsAnnonce" ADD CONSTRAINT "AdsAnnonce_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsAnnonce" ADD CONSTRAINT "AdsAnnonce_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsAnnonce" ADD CONSTRAINT "AdsAnnonce_groupeId_fkey"
  FOREIGN KEY ("groupeId") REFERENCES "AdsGroupe" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdsAnnonce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsAnnonce" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsannonce_owner ON "AdsAnnonce" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- 4. Les bornes du pilote automatique.
--
-- Le troisième mode n'existe pas encore, et il ne doit pas pouvoir exister sans ses bornes :
-- un pilote automatique sans plafond est exactement ce que le produit s'interdit depuis le
-- premier jour — « Naya n'a jamais d'autonomie financière illimitée » (garde-fous.ts).
-- Elles sont donc posées AVANT le mode lui-même, et toutes à zéro, c'est-à-dire fermées.
--
-- Distinctes des objectifs déjà présents sur ce profil, et la nuance décide de tout : le CPA
-- cible dit ce qu'on vise, le CPA maximum dit à partir de quand une machine doit s'arrêter
-- de dépenser. Les confondre laisserait un agent s'autoriser tout ce qui n'a pas encore
-- atteint la cible.
ALTER TABLE "AdsProfil"
  -- Faux tant que la personne ne l'a pas explicitement armé. Le mode du compte ne suffit
  -- pas : deux interrupteurs valent mieux qu'un pour ce qui engage de l'argent seul.
  ADD COLUMN "piloteActif"             BOOLEAN NOT NULL DEFAULT false,
  -- En pourcentage entier. 0 : aucune hausse autorisée, ce qui est le défaut.
  ADD COLUMN "piloteHausseMaxPourcent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "piloteBaisseMaxPourcent" INTEGER NOT NULL DEFAULT 0,
  -- Le budget quotidien qu'aucune hausse automatique ne peut franchir, en micros.
  ADD COLUMN "piloteBudgetJourMaxMicros" BIGINT NOT NULL DEFAULT 0,
  -- La dépense totale au-delà de laquelle le pilote se tait, en micros et sur le mois.
  ADD COLUMN "piloteDepenseMaxMicros"  BIGINT  NOT NULL DEFAULT 0,
  -- La limite, pas la cible. Au-delà, une machine ne monte plus un budget.
  ADD COLUMN "piloteCpaMaxMicros"      BIGINT  NOT NULL DEFAULT 0,
  -- En pourcentage entier : 250 veut dire 250 %. En deçà, le pilote ne monte rien.
  ADD COLUMN "piloteRoasMin"           INTEGER NOT NULL DEFAULT 0,
  -- Les identifiants de campagne où le pilote a le droit d'agir. Vide : aucune. Une liste
  -- blanche, jamais une liste noire — l'oubli doit fermer, pas ouvrir.
  ADD COLUMN "piloteCampagnes"         JSONB   NOT NULL DEFAULT '[]',
  -- Les types d'action autorisés : budget, pause, reprise. Vide : aucun.
  ADD COLUMN "piloteActions"           JSONB   NOT NULL DEFAULT '[]';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsAnnonce" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
