-- Ce que contiennent les campagnes, et ce que les gens ont réellement tapé.
--
-- Trois tables, et la première question à laquelle elles répondent est : « qu'y a-t-il
-- déjà ? ». On n'améliore pas des composants qu'on n'a pas lus, et proposer un titre sans
-- connaître les quinze qui existent revient à proposer le seizième doublon.
--
-- Deux décisions traversent le fichier.
--
-- **Le vocabulaire est celui d'Evoliia, pas celui de Google.** Une campagne Recherche range
-- ses annonces dans des « groupes d'annonces » ; une Performance Max range ses titres et ses
-- images dans des « groupes d'éléments ». Ce sont deux mots pour un même rôle : un
-- contenant. Les garder distincts jusqu'à l'écran remplirait tout le code de conditions, et
-- Meta apporterait un troisième mot. Une seule table, un champ « genre ».
--
-- **Les termes de recherche sont une photographie, pas un historique.** Contrairement aux
-- journées de dépense, ils sont réécrits à chaque lecture : ce qui intéresse est ce que les
-- gens tapent en ce moment, et conserver trente versions du même terme ferait une table
-- énorme dont personne ne lirait jamais les vieilles lignes.

-- ── Le contenant : groupe d'annonces ou groupe d'éléments ────────────────────

CREATE TABLE "AdsGroupe" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "accountId"  UUID NOT NULL,
  "campagneId" UUID NOT NULL,

  -- L'identifiant chez la plateforme : c'est lui qu'on renvoie pour ajouter un élément.
  "groupeId"   TEXT NOT NULL,
  "nom"        TEXT NOT NULL DEFAULT '',
  -- annonces | elements : le rôle, pas le mot de Google.
  "genre"      TEXT NOT NULL DEFAULT 'annonces',
  "statut"     TEXT NOT NULL DEFAULT '',

  "vueAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsGroupe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsGroupe_accountId_groupeId_key" ON "AdsGroupe" ("accountId", "groupeId");
CREATE INDEX "AdsGroupe_campagneId_idx" ON "AdsGroupe" ("campagneId");

ALTER TABLE "AdsGroupe" ADD CONSTRAINT "AdsGroupe_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsGroupe" ADD CONSTRAINT "AdsGroupe_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsGroupe" ADD CONSTRAINT "AdsGroupe_campagneId_fkey"
  FOREIGN KEY ("campagneId") REFERENCES "AdsCampagne" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Le morceau : un titre, une description, une image ────────────────────────
--
-- L'unicité porte sur le texte et non sur l'identifiant de la plateforme, parce que les
-- deux sources n'en donnent pas. Une annonce responsive porte ses titres en ligne, sans
-- identifiant propre ; un groupe d'éléments les porte comme objets numérotés. Le texte,
-- lui, existe des deux côtés — et Google refuse déjà deux titres identiques dans un même
-- contenant, donc il identifie aussi sûrement qu'un numéro.

CREATE TABLE "AdsElement" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL,
  "accountId"   UUID NOT NULL,
  "groupeId"    UUID NOT NULL,

  -- titre | titre-long | description | image | logo
  "champ"       TEXT NOT NULL,
  -- Le texte, ou l'adresse de l'image. Un seul champ : c'est le contenu du morceau.
  "texte"       TEXT NOT NULL,
  -- L'identifiant de l'élément chez la plateforme, quand elle en donne un.
  "elementId"   TEXT NOT NULL DEFAULT '',
  -- LOW | GOOD | BEST | LEARNING | PENDING, la note de Google, reprise telle quelle. Jamais
  -- traduite en note sur cent : ce n'en est pas une, et la convertir inventerait une échelle.
  "performance" TEXT NOT NULL DEFAULT '',
  -- google | evoliia : d'où vient ce morceau. Sert à mesurer ce que Naya a réellement apporté.
  "origine"     TEXT NOT NULL DEFAULT 'google',

  "vueAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsElement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsElement_groupeId_champ_texte_key"
  ON "AdsElement" ("groupeId", "champ", "texte");
CREATE INDEX "AdsElement_accountId_champ_idx" ON "AdsElement" ("accountId", "champ");

ALTER TABLE "AdsElement" ADD CONSTRAINT "AdsElement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsElement" ADD CONSTRAINT "AdsElement_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsElement" ADD CONSTRAINT "AdsElement_groupeId_fkey"
  FOREIGN KEY ("groupeId") REFERENCES "AdsGroupe" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Ce que les gens ont tapé ─────────────────────────────────────────────────
--
-- La matière première de tout ce qui suit. Un titre écrit à partir de ce que quelqu'un a
-- réellement tapé vaut mieux qu'un titre écrit à partir de ce qu'on croit qu'il tape — et
-- c'est la seule source du produit qui donne les mots des gens plutôt que les nôtres.
--
-- Réservé aux campagnes qui en rendent : une Performance Max ne livre que des catégories
-- agrégées, jamais les termes bruts. C'est une limite de Google, et l'écran doit la dire
-- plutôt que de laisser croire à une campagne sans demande.

CREATE TABLE "AdsTerme" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL,
  "accountId"   UUID NOT NULL,
  "campagneId"  UUID NOT NULL,

  "terme"       TEXT NOT NULL,
  "impressions" BIGINT NOT NULL DEFAULT 0,
  "clics"       BIGINT NOT NULL DEFAULT 0,
  "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "coutMicros"  BIGINT NOT NULL DEFAULT 0,
  -- achat | comparaison | local | information, classé par le même code que le référencement.
  "intention"   TEXT NOT NULL DEFAULT 'information',

  "vueAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsTerme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsTerme_campagneId_terme_key" ON "AdsTerme" ("campagneId", "terme");
CREATE INDEX "AdsTerme_accountId_idx" ON "AdsTerme" ("accountId");

ALTER TABLE "AdsTerme" ADD CONSTRAINT "AdsTerme_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsTerme" ADD CONSTRAINT "AdsTerme_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsTerme" ADD CONSTRAINT "AdsTerme_campagneId_fkey"
  FOREIGN KEY ("campagneId") REFERENCES "AdsCampagne" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── La dernière lecture du créatif ───────────────────────────────────────────
--
-- Séparée de `synchroAt` parce qu'elle n'a pas le même rythme. Les dépenses changent chaque
-- nuit ; les titres d'une annonce changent une fois par trimestre. Relire le créatif chaque
-- nuit coûterait trois appels par compte et par jour sur un plafond partagé par tous les
-- utilisateurs d'Evoliia, pour apprendre chaque fois la même chose.

ALTER TABLE "AdsAccount" ADD COLUMN "creaAt" TIMESTAMP(3);

-- ── Cloisonnement ────────────────────────────────────────────────────────────

ALTER TABLE "AdsGroupe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsGroupe" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsgroupe_owner ON "AdsGroupe" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsElement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsElement" FORCE ROW LEVEL SECURITY;
CREATE POLICY adselement_owner ON "AdsElement" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsTerme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsTerme" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsterme_owner ON "AdsTerme" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsGroupe" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsElement" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsTerme" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
