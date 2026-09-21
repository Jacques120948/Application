-- Le mode assisté : ce qu'il faut en base pour qu'une écriture soit réversible.
--
-- Deux colonnes seulement, et chacune existe pour empêcher une chose précise.
--
-- **Le mode.** Une autorisation Google Ads donne le droit d'écrire ; elle ne dit pas qu'on
-- le souhaite. La portée `adwords` n'existe qu'en version complète — demander à lire, c'est
-- obtenir le droit de modifier — et sans un réglage explicite, toute personne ayant relié
-- son compte se retrouverait un cran plus loin qu'elle ne l'a voulu. « lecture » est donc
-- le défaut, y compris pour les comptes déjà reliés : personne ne se réveille en mode
-- assisté à cause d'une migration.
--
-- **Le lien vers la recommandation.** Une action appliquée doit pouvoir dire de quel constat
-- elle vient. Sans ce lien, le journal deviendrait une suite de modifications sans motif —
-- « budget passé de 15 à 18 le 3 octobre » — et personne, trois mois plus tard, ne saurait
-- plus pourquoi.

ALTER TABLE "AdsAccount"
  -- lecture | assiste. « autopilote » n'existe pas : rien ne l'exécute.
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'lecture';

ALTER TABLE "AdsAction"
  ADD COLUMN "recommandationId" UUID;

ALTER TABLE "AdsAction" ADD CONSTRAINT "AdsAction_recommandationId_fkey"
  FOREIGN KEY ("recommandationId") REFERENCES "AdsRecommandation" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AdsAction_recommandationId_idx" ON "AdsAction" ("recommandationId");

-- Les politiques de cloisonnement et les octrois portent déjà sur ces tables : une colonne
-- de plus ne les change pas. Rien à ajouter ici, et c'est voulu — un `GRANT` oublié se
-- voit tout de suite, un `GRANT` de trop ne se voit jamais.
