-- Naya, et ce qu'il faut garder pour parler de publicité sans rien inventer.
--
-- Six tables, et la raison d'être de chacune tient en une phrase : sans mesure d'hier, on
-- ne peut rien dire d'aujourd'hui. Google Ads rend l'état du moment ; il ne rend pas
-- « votre ROAS a baissé de dix-huit points cette semaine ». Cette phrase-là se fabrique en
-- gardant une ligne par campagne et par jour, et en soustrayant.
--
-- Deux décisions traversent tout le fichier.
--
-- **L'argent est en micros, en entier long.** Google rend des « micros » : un millionième
-- d'unité monétaire. Les reconvertir en nombre à virgule à l'écriture ferait entrer une
-- imprécision dans la seule donnée du produit qui soit de l'argent réel, et une somme de
-- trois cents journées d'imprécisions finit par se voir. La conversion se fait à la
-- lecture, une fois, au moment d'afficher.
--
-- **La devise n'est jamais supposée.** Elle est celle du compte Google Ads, conservée avec
-- lui. Un budget affiché en euros à quelqu'un qui paie en francs est un chiffre faux
-- présenté comme vrai.

-- ── Le compte publicitaire relié ─────────────────────────────────────────────
--
-- Les jetons d'accès ne sont pas ici : ils vivent dans `IntegrationCredential`, chiffrés,
-- comme ceux de Search Console et de Shopify. Cette table ne porte que ce qu'on affiche.

CREATE TABLE "AdsAccount" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL,
  -- La plateforme. « google-ads » aujourd'hui ; Meta et Microsoft s'y rangeront.
  "plateforme"  TEXT NOT NULL DEFAULT 'google-ads',
  -- L'identifiant du compte chez la plateforme. Chez Google : le customer ID, sans tirets.
  "compteId"    TEXT NOT NULL,
  -- Le nom que la personne reconnaîtra dans sa propre interface.
  "nom"         TEXT NOT NULL DEFAULT '',
  -- CHF, EUR, USD… telle que la plateforme la déclare. Jamais déduite, jamais par défaut.
  "devise"      TEXT NOT NULL DEFAULT '',
  -- Le fuseau du compte : c'est lui qui décide où commence une journée de dépense.
  "fuseau"      TEXT NOT NULL DEFAULT '',
  -- Un compte administrateur ne diffuse pas de publicité : il en gère d'autres.
  "gestionnaire" BOOLEAN NOT NULL DEFAULT false,
  -- Celui que Naya lit. Une personne peut en relier plusieurs et n'en suivre qu'un.
  "actif"       BOOLEAN NOT NULL DEFAULT false,
  -- Dernière synchronisation réussie. Affichée telle quelle : « Aujourd'hui 14:32 ».
  "synchroAt"   TIMESTAMP(3),

  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsAccount_pkey" PRIMARY KEY ("id")
);

-- Le même compte relié deux fois donnerait deux historiques à moitié remplis.
CREATE UNIQUE INDEX "AdsAccount_userId_plateforme_compteId_key"
  ON "AdsAccount" ("userId", "plateforme", "compteId");
CREATE INDEX "AdsAccount_userId_actif_idx" ON "AdsAccount" ("userId", "actif");

ALTER TABLE "AdsAccount" ADD CONSTRAINT "AdsAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Ce que la personne vise ──────────────────────────────────────────────────
--
-- Un ROAS de 250 % est excellent pour l'une et insuffisant pour l'autre : c'est la marge
-- qui tranche, pas une moyenne de marché. Sans ces champs, toute recommandation serait
-- adossée à une norme inventée.

CREATE TABLE "AdsProfil" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL,
  "accountId"      UUID NOT NULL,

  "activite"       TEXT NOT NULL DEFAULT '',
  "pays"           TEXT NOT NULL DEFAULT '',
  "produits"       TEXT NOT NULL DEFAULT '',
  -- En micros de la devise du compte, comme tout le reste de l'argent ici.
  "panierMoyenMicros" BIGINT NOT NULL DEFAULT 0,
  -- Marge moyenne en pourcentage entier. C'est elle qui rend un ROAS interprétable.
  "margePourcent"  INTEGER NOT NULL DEFAULT 0,
  -- Objectif de rentabilité, en pourcentage entier : 200 veut dire 200 %.
  "roasCible"      INTEGER NOT NULL DEFAULT 0,
  "cpaCibleMicros" BIGINT NOT NULL DEFAULT 0,
  "budgetMensuelMicros" BIGINT NOT NULL DEFAULT 0,
  -- conversions | valeur | roas | cpa : ce que la personne cherche à maximiser.
  "objectif"       TEXT NOT NULL DEFAULT 'conversions',

  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsProfil_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsProfil_accountId_key" ON "AdsProfil" ("accountId");

ALTER TABLE "AdsProfil" ADD CONSTRAINT "AdsProfil_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsProfil" ADD CONSTRAINT "AdsProfil_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Les campagnes, et leur état du moment ────────────────────────────────────

CREATE TABLE "AdsCampagne" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "accountId"    UUID NOT NULL,

  -- L'identifiant chez la plateforme. C'est lui qu'on renvoie pour modifier quoi que ce soit.
  "campagneId"   TEXT NOT NULL,
  "nom"          TEXT NOT NULL DEFAULT '',
  -- SEARCH | SHOPPING | PERFORMANCE_MAX | … tel que la plateforme le nomme.
  "type"         TEXT NOT NULL DEFAULT '',
  -- ENABLED | PAUSED | REMOVED, tel quel. On n'invente pas un vocabulaire par-dessus.
  "statut"       TEXT NOT NULL DEFAULT '',
  "budgetMicros" BIGINT NOT NULL DEFAULT 0,
  -- L'identifiant du budget partagé : chez Google, un budget peut servir plusieurs campagnes.
  -- Le modifier sans le savoir changerait le budget d'une campagne qu'on ne regardait pas.
  "budgetId"     TEXT NOT NULL DEFAULT '',
  -- Vrai quand la plateforme signale que la campagne est bridée par son budget.
  "budgetLimite" BOOLEAN NOT NULL DEFAULT false,

  "vueAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsCampagne_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsCampagne_accountId_campagneId_key"
  ON "AdsCampagne" ("accountId", "campagneId");

ALTER TABLE "AdsCampagne" ADD CONSTRAINT "AdsCampagne_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsCampagne" ADD CONSTRAINT "AdsCampagne_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Une ligne par campagne et par jour ───────────────────────────────────────
--
-- C'est la table qui porte tout le reste. « Votre ROAS a baissé » n'est pas une donnée que
-- Google rend : c'est une soustraction entre deux journées, et elle exige qu'on ait gardé
-- les deux. Les journées sont réécrites lorsqu'on les relit — Google corrige ses chiffres
-- pendant quelques jours, et une ligne figée le jour même serait fausse la semaine suivante.

CREATE TABLE "AdsReleve" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL,
  "accountId"        UUID NOT NULL,
  "campagneId"       UUID NOT NULL,

  -- Le jour, dans le fuseau du compte. C'est le compte qui décide où commence une journée.
  "jour"             DATE NOT NULL,
  "coutMicros"       BIGINT NOT NULL DEFAULT 0,
  "impressions"      BIGINT NOT NULL DEFAULT 0,
  "clics"            BIGINT NOT NULL DEFAULT 0,
  -- Fractionnaire : Google compte les conversions au dixième quand elles sont pondérées.
  "conversions"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "valeurConversion" DOUBLE PRECISION NOT NULL DEFAULT 0,

  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsReleve_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsReleve_campagneId_jour_key" ON "AdsReleve" ("campagneId", "jour");
CREATE INDEX "AdsReleve_accountId_jour_idx" ON "AdsReleve" ("accountId", "jour" DESC);

ALTER TABLE "AdsReleve" ADD CONSTRAINT "AdsReleve_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsReleve" ADD CONSTRAINT "AdsReleve_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsReleve" ADD CONSTRAINT "AdsReleve_campagneId_fkey"
  FOREIGN KEY ("campagneId") REFERENCES "AdsCampagne" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Ce que Naya propose ──────────────────────────────────────────────────────
--
-- Conservées plutôt que recalculées à chaque ouverture : une recommandation ignorée doit le
-- rester, et une recommandation appliquée doit pouvoir être relue plus tard avec les
-- chiffres qui l'ont motivée. Recalculer effacerait les deux.

CREATE TABLE "AdsRecommandation" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "accountId"  UUID NOT NULL,
  "campagneId" UUID,

  -- Identifiant stable de la règle qui l'a produite : ads.budget.limite, ads.roas.chute…
  "regle"      TEXT NOT NULL,
  -- urgent | surveiller | opportunite | information
  "priorite"   TEXT NOT NULL DEFAULT 'information',
  "titre"      TEXT NOT NULL DEFAULT '',
  -- Ce qui a été constaté, écrit par le code et non par un modèle.
  "observation" TEXT NOT NULL DEFAULT '',
  "jours"      INTEGER NOT NULL DEFAULT 0,
  -- Les chiffres qui la motivent, gardés tels quels : c'est ce qui rend l'avis contestable.
  "donnees"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- L'explication en français, écrite par Naya à partir de ces chiffres-là.
  "explication" TEXT NOT NULL DEFAULT '',
  -- L'action proposée, sous une forme que le serveur sait exécuter. Jamais du texte libre.
  "action"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- faible | moyen | eleve : ce qu'on risque à l'appliquer.
  "risque"     TEXT NOT NULL DEFAULT 'faible',
  -- ouverte | appliquee | ignoree | perimee
  "etat"       TEXT NOT NULL DEFAULT 'ouverte',

  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"   TIMESTAMP(3),

  CONSTRAINT "AdsRecommandation_pkey" PRIMARY KEY ("id")
);

-- Une seule recommandation ouverte par règle et par campagne : sans cela, une anomalie qui
-- dure trois semaines produirait vingt et une lignes identiques, et l'écran dirait
-- « vingt et un problèmes » là où il y en a un depuis trois semaines.
CREATE UNIQUE INDEX "AdsRecommandation_ouverte_unique"
  ON "AdsRecommandation" ("accountId", "regle", COALESCE("campagneId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "etat" = 'ouverte';
CREATE INDEX "AdsRecommandation_accountId_etat_idx" ON "AdsRecommandation" ("accountId", "etat");

ALTER TABLE "AdsRecommandation" ADD CONSTRAINT "AdsRecommandation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsRecommandation" ADD CONSTRAINT "AdsRecommandation_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsRecommandation" ADD CONSTRAINT "AdsRecommandation_campagneId_fkey"
  FOREIGN KEY ("campagneId") REFERENCES "AdsCampagne" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Le journal, et la condition du retour arrière ────────────────────────────
--
-- Toute modification envoyée chez la plateforme est écrite ici AVANT d'être envoyée, avec
-- sa valeur d'avant. C'est ce qui fait la différence entre un bouton « restaurer 40 CHF »
-- qui restaure vraiment et un bouton qui ment : si la valeur d'avant n'a pas été gardée au
-- moment où on la connaissait encore, elle est perdue.

CREATE TABLE "AdsAction" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "accountId"  UUID NOT NULL,
  "campagneId" UUID,

  -- budget | pause | reprise | mot-cle-negatif … le type d'écriture tenté.
  "quoi"       TEXT NOT NULL,
  -- Pourquoi, en français, tel qu'on le montrera dans l'historique.
  "motif"      TEXT NOT NULL DEFAULT '',
  -- La valeur d'avant et celle d'après, sous la forme que le serveur sait rejouer.
  "avant"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "apres"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- assiste | autopilote | restauration
  "mode"       TEXT NOT NULL DEFAULT 'assiste',
  -- prevu | reussi | refuse : « prevu » est l'état d'une écriture commencée et non confirmée.
  "resultat"   TEXT NOT NULL DEFAULT 'prevu',
  -- Le refus de la plateforme, en clair et sans secret, quand il y en a un.
  "detail"     TEXT NOT NULL DEFAULT '',
  -- L'action que celle-ci annule, quand c'est une restauration.
  "annuleId"   UUID,

  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdsAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdsAction_accountId_createdAt_idx" ON "AdsAction" ("accountId", "createdAt" DESC);
CREATE INDEX "AdsAction_campagneId_quoi_idx" ON "AdsAction" ("campagneId", "quoi");

ALTER TABLE "AdsAction" ADD CONSTRAINT "AdsAction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsAction" ADD CONSTRAINT "AdsAction_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsAction" ADD CONSTRAINT "AdsAction_campagneId_fkey"
  FOREIGN KEY ("campagneId") REFERENCES "AdsCampagne" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdsAction" ADD CONSTRAINT "AdsAction_annuleId_fkey"
  FOREIGN KEY ("annuleId") REFERENCES "AdsAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Cloisonnement ────────────────────────────────────────────────────────────
--
-- Les dépenses publicitaires d'une entreprise sont parmi les données les plus sensibles
-- qu'Evoliia détienne : ce qu'elle dépense, ce que ça rapporte, sur quels mots. `FORCE` est
-- indispensable — sans lui, le propriétaire des tables contournerait ses propres règles, et
-- c'est précisément lui qui exécute les migrations.

ALTER TABLE "AdsAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsaccount_owner ON "AdsAccount" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsProfil" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsProfil" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsprofil_owner ON "AdsProfil" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsCampagne" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsCampagne" FORCE ROW LEVEL SECURITY;
CREATE POLICY adscampagne_owner ON "AdsCampagne" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsReleve" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsReleve" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsreleve_owner ON "AdsReleve" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsRecommandation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsRecommandation" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsrecommandation_owner ON "AdsRecommandation" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "AdsAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsaction_owner ON "AdsAction" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsAccount" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsProfil" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsCampagne" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsReleve" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsRecommandation" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsAction" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
