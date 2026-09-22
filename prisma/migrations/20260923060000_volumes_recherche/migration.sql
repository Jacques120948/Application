-- Le volume de recherche d'un mot, gardé plutôt que redemandé.
--
-- Search Console dit combien de fois VOTRE site a été montré sur une recherche. Il ne dit
-- jamais combien de fois cette recherche a été tapée. Les deux se confondent facilement et
-- l'écart est tout le sujet : sortir trentième sur un mot cherché cinq mille fois par mois
-- donne moins d'affichages que sortir troisième sur un mot cherché vingt fois. La première
-- ligne est une occasion, la seconde un cul-de-sac, et les chiffres de Search Console les
-- montrent dans le mauvais ordre.
--
-- Le volume vient du planificateur de Google Ads, et c'est pour cela que cette table existe.
--
-- **Il est gardé, pas relu à chaque affichage.** Un volume est une moyenne mensuelle : il ne
-- change pas d'un jour à l'autre. Le redemander à chaque ouverture d'écran ajouterait un
-- aller-retour à chaque page et consommerait le quota d'appels d'Evoliia — un quota partagé
-- par tous ses utilisateurs, et dont l'épuisement casserait la création de campagnes de tout
-- le monde. Avec cette table, un site coûte un appel par mois au lieu d'un par visite.
--
-- **Il est cloisonné par utilisateur comme tout le reste.** Le volume de « bougie citrine »
-- en Suisse est le même pour tout le monde, et une table partagée aurait divisé le coût
-- encore un peu. Elle aurait aussi laissé deviner, de l'extérieur, quels mots les autres
-- suivent. Le gain ne valait pas la fuite : à un appel par site et par mois, il n'y avait
-- déjà plus rien à économiser.
--
-- **Le marché et la langue font partie de la clé.** « bougie » n'a pas le même volume en
-- Suisse et en France, ni en français et en allemand. Les confondre rendrait un nombre vrai
-- qui décrit un autre pays.

CREATE TABLE "VolumeRecherche" (
  "id"     UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "siteId" UUID NOT NULL,

  -- Le mot, normalisé : minuscules, espaces réduits. C'est la forme sous laquelle il est
  -- envoyé chez Google et celle sous laquelle il est relu — deux formes donneraient deux
  -- lignes pour un seul mot, et un cache qui ne trouve jamais rien.
  "motCle" TEXT NOT NULL,
  -- La ressource géographique de Google, ex. « geoTargetConstants/2756 ».
  "marche" TEXT NOT NULL,
  -- Le code de langue à deux lettres, tel qu'Evoliia le manipule.
  "langue" TEXT NOT NULL,

  -- La moyenne mensuelle rendue par Google. -1 : demandé, mais Google n'a rien à dire.
  -- Distinct de 0, qui est une réponse : « personne ne cherche cela ».
  "volume"         INTEGER NOT NULL DEFAULT -1,
  -- LOW | MEDIUM | HIGH | '' : la concurrence publicitaire, telle que Google la nomme.
  "concurrence"    TEXT    NOT NULL DEFAULT '',
  -- La fourchette d'enchère en haut de page, en micros. Elle dit ce que ce mot vaut à ceux
  -- qui le paient — un repère utile même pour qui ne compte pas acheter.
  "coutBasMicros"  BIGINT  NOT NULL DEFAULT 0,
  "coutHautMicros" BIGINT  NOT NULL DEFAULT 0,

  "releveAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VolumeRecherche_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VolumeRecherche_cle_key"
  ON "VolumeRecherche" ("siteId", "marche", "langue", "motCle");
CREATE INDEX "VolumeRecherche_siteId_releveAt_idx"
  ON "VolumeRecherche" ("siteId", "releveAt");

ALTER TABLE "VolumeRecherche" ADD CONSTRAINT "VolumeRecherche_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VolumeRecherche" ADD CONSTRAINT "VolumeRecherche_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VolumeRecherche" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VolumeRecherche" FORCE ROW LEVEL SECURITY;
CREATE POLICY volumerecherche_owner ON "VolumeRecherche" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "VolumeRecherche" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
