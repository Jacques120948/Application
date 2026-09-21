-- La langue et l'intention d'un mot-clé proposé.
--
-- Deux colonnes, deux fautes corrigées.
--
-- La langue, parce qu'une boutique suisse travaille en trois langues et que ses chiffres
-- italiens ne sont pas du trafic égaré : c'est sa version italienne qui travaille. Demander
-- les volumes en français pour « diaspro rosso » rendait des nombres vrais qui ne
-- décrivaient rien. Elle sert aussi à l'écran : déposer un mot-clé italien dans un groupe
-- d'annonces français ferait voir aux gens une annonce dans une langue qu'ils n'ont pas
-- cherchée.
--
-- L'intention, parce que le classement existait déjà — il sert à choisir les sujets
-- d'articles — mais n'avait jamais été branché ici. C'est ce qui faisait proposer à l'achat
-- une recherche sur les vertus d'une pierre : trois mille six cents recherches par mois, un
-- clic à trois centimes, et personne qui veuille acheter une bougie.

ALTER TABLE "AdsMotCle"
  -- « fr », « de », « it »… lue sur la page qui sert la requête. Vide : inconnue.
  ADD COLUMN "langue" TEXT NOT NULL DEFAULT '',
  -- achat | comparaison | local | information. Vide pour les lignes d'avant ce changement.
  ADD COLUMN "intention" TEXT NOT NULL DEFAULT '';
