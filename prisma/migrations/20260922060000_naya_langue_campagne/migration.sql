-- La langue qu'une campagne cible, telle qu'elle la déclare à Google.
--
-- La rédaction écrivait en français quoi qu'il arrive. Pour une boutique suisse qui sert
-- trois langues, c'est une faute qui ne se voit pas tout de suite : les titres proposés sont
-- bons, ils sont simplement dans la mauvaise langue — et une annonce que le public visé ne
-- comprend pas consomme ses impressions sans jamais être cliquée.
--
-- Cette langue n'est ni devinée sur les mots des mots-clés, ni supposée d'après l'interface.
-- Elle est lue dans le ciblage linguistique de la campagne, où la personne l'a posée
-- elle-même. Vide quand la campagne en cible plusieurs ou aucune : dans ce cas on ne sait
-- pas, et la rédaction retombe sur la langue du site plutôt que de choisir au hasard.

ALTER TABLE "AdsCampagne"
  -- « fr », « de », « it »… Vide : la campagne n'en cible pas une seule, ou pas encore lue.
  ADD COLUMN "langue" TEXT NOT NULL DEFAULT '';
