-- Un mot-clé que Naya propose d'acheter, et ce qu'il coûterait.
--
-- Une table à part des propositions de texte, et ce n'est pas de la symétrie : un mot-clé
-- porte des chiffres qu'un titre n'a pas. Ce que Search Console sait de la requête sur le
-- site — sa position, ses impressions — dit s'il vaut la peine de payer pour elle. Ce que le
-- planificateur de Google dit du marché — volume, fourchette de coût par clic — dit ce que
-- ça coûterait. Les deux ensemble font une décision ; l'un sans l'autre fait une intuition.
--
-- Les chiffres sont figés au moment de la proposition, et c'est voulu. Le planificateur
-- consomme le quota d'API partagé par tous les utilisateurs d'Evoliia : rouvrir l'écran ne
-- doit pas le rappeler. Une proposition vieille de trois semaines se redemande, elle ne se
-- rafraîchit pas en silence.

CREATE TABLE "AdsMotCle" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "groupeId"  UUID NOT NULL,

  "texte"          TEXT NOT NULL,
  -- phrase | exact. Jamais « large » : sur un petit budget, la correspondance large dépense
  -- l'essentiel du budget sur des recherches voisines que personne n'a choisies.
  "correspondance" TEXT NOT NULL DEFAULT 'phrase',

  -- Ce que Search Console sait de cette requête sur le site. Zéro : elle n'y figure pas, le
  -- mot-clé vient du planificateur seul.
  "position"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clics"       INTEGER NOT NULL DEFAULT 0,

  -- Recherches mensuelles moyennes, telles que le planificateur les rend. Zéro : il n'en
  -- donne pas, ce qui arrive sur les requêtes rares — et se dit à l'écran plutôt que de
  -- passer pour un volume nul.
  "volume"         INTEGER NOT NULL DEFAULT 0,
  -- La fourchette du coût par clic en haut de page, en micros de la devise du compte.
  "coutBasMicros"  BIGINT NOT NULL DEFAULT 0,
  "coutHautMicros" BIGINT NOT NULL DEFAULT 0,
  "concurrence"    TEXT NOT NULL DEFAULT '',

  -- Pourquoi elle est là : la phrase qui rend la proposition discutable.
  "motif"     TEXT NOT NULL DEFAULT '',
  -- proposee | deposee | ecartee
  "etat"      TEXT NOT NULL DEFAULT 'proposee',
  -- Le nom de ressource du critère chez Google, écrit au dépôt. Sans lui, le retour arrière
  -- n'aurait rien à retirer.
  "critereId" TEXT NOT NULL DEFAULT '',

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"  TIMESTAMP(3),

  CONSTRAINT "AdsMotCle_pkey" PRIMARY KEY ("id")
);

-- Le même mot dans la même correspondance ne se propose pas deux fois. Les deux
-- correspondances du même mot, en revanche, sont deux achats différents.
CREATE UNIQUE INDEX "AdsMotCle_groupeId_texte_correspondance_key"
  ON "AdsMotCle" ("groupeId", "texte", "correspondance");
CREATE INDEX "AdsMotCle_groupeId_etat_idx" ON "AdsMotCle" ("groupeId", "etat");

ALTER TABLE "AdsMotCle" ADD CONSTRAINT "AdsMotCle_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsMotCle" ADD CONSTRAINT "AdsMotCle_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdsAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdsMotCle" ADD CONSTRAINT "AdsMotCle_groupeId_fkey"
  FOREIGN KEY ("groupeId") REFERENCES "AdsGroupe" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdsMotCle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdsMotCle" FORCE ROW LEVEL SECURITY;
CREATE POLICY adsmotcle_owner ON "AdsMotCle" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AdsMotCle" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
