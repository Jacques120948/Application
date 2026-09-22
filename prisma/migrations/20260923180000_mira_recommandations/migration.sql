-- Une recommandation en quatre temps, et à n'importe quel étage.
--
-- La table servait Naya, dont les constats portent tous sur une campagne et se disent en une
-- observation. MIRA a besoin de deux choses de plus, et aucune n'est propre à Meta : elle
-- généralise ce que Naya pourra reprendre.
--
-- **L'étage visé.** Chez Google, une recommandation porte sur une campagne. Chez Meta, le
-- budget vit sur l'ensemble de publicités et la fatigue sur l'annonce : proposer une pause
-- de campagne quand une seule annonce s'essouffle éteindrait aussi ce qui marche. La colonne
-- `campagneId` reste, pour le lien ; `niveau` et `cibleId` disent ce qu'on vise vraiment.
--
-- **Les quatre temps.** « Votre fréquence est à 4,2 » ne fait agir personne ; « votre
-- fréquence est à 4,2, donc les mêmes personnes voient la même image quatre fois, donc votre
-- coût par vente va monter, donc changez de visuel » fait agir. L'observation existait déjà.
-- Le mécanisme, la conséquence et la proposition manquaient, et les entasser dans le champ
-- d'observation aurait rendu impossible de les afficher séparément — or c'est la séparation
-- qui fait la différence à l'écran : on lit la proposition, on déplie le reste si l'on doute.
--
-- Toutes par défaut vides : les lignes de Naya restent valides sans être touchées, et ses
-- règles pourront les remplir le jour où on le voudra.

ALTER TABLE "AdsRecommandation"
  -- campagne | ensemble | annonce. « campagne » par défaut : c'est ce que portent les
  -- lignes existantes, et le défaut ne doit rien changer à ce qui existe.
  ADD COLUMN "niveau"         TEXT NOT NULL DEFAULT 'campagne',
  -- Le nom de l'objet visé, tel qu'il s'affiche. Rafraîchi avec le reste du constat : le
  -- titre le porte déjà, et le figer ici ferait dire deux noms différents à la même ligne
  -- après un renommage.
  ADD COLUMN "cible"          TEXT NOT NULL DEFAULT '',
  -- Son identifiant interne. C'est lui que portera l'action, jamais le nom.
  ADD COLUMN "cibleId"        TEXT NOT NULL DEFAULT '',
  -- Le mécanisme : pourquoi cela se produit. Écrit par le code, pas par un modèle.
  ADD COLUMN "pourquoi"       TEXT NOT NULL DEFAULT '',
  -- Ce qu'il arrive si l'on ne fait rien. Jamais une promesse chiffrée.
  ADD COLUMN "consequence"    TEXT NOT NULL DEFAULT '',
  -- Ce qu'on propose, en français. L'action exécutable reste dans la colonne `action`.
  ADD COLUMN "recommandation" TEXT NOT NULL DEFAULT '';

-- La clé d'unicité d'un constat devient la règle ET la cible, et non plus la règle et la
-- campagne.
--
-- Sans ce changement, deux annonces de la même campagne qui fatiguent en même temps se
-- disputeraient la même ligne : la première ouverte interdirait la seconde, et chaque
-- passage nocturne réécrirait l'unique ligne avec les chiffres de l'une puis de l'autre. On
-- afficherait un problème là où il y en a deux, et jamais le même.
--
-- Les lignes de Naya portent une cible vide : à cible constante, la clé reste ce qu'elle
-- était, et rien de ce qui existe ne change de comportement.
DROP INDEX "AdsRecommandation_ouverte_unique";
CREATE UNIQUE INDEX "AdsRecommandation_ouverte_unique"
  ON "AdsRecommandation" (
    "accountId",
    "regle",
    COALESCE("campagneId", '00000000-0000-0000-0000-000000000000'::uuid),
    "cibleId"
  )
  WHERE "etat" = 'ouverte';
