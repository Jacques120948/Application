-- Combien d'actions de conversion comptent réellement dans ce compte.
--
-- Toute la machinerie de Naya repose sur une donnée qu'elle n'avait jamais vérifiée : les
-- conversions. Le ROAS, le coût par vente, la rentabilité, six règles sur neuf — tout devient
-- muet, ou pire, faussement rassurant, si rien ne remonte. Une campagne sans vente mesurée
-- ressemble exactement à une campagne sans vente.
--
-- « Actives » veut dire deux choses à la fois, et c'est le piège que cette colonne existe
-- pour éviter : activée, ET comptée dans la colonne « Conversions ». Un compte peut porter
-- cent actions activées mais secondaires — des restes d'un outil tiers, par exemple — et
-- n'avoir aucune vente comptée. Le nombre brut d'actions activées dirait alors que tout va
-- bien.
--
-- -1 : jamais lu. Distinct de 0, qui est un constat. La règle se tait sur -1, parce qu'un
-- silence vaut mieux qu'une alerte fondée sur une lecture qui n'a pas eu lieu.

ALTER TABLE "AdsAccount"
  ADD COLUMN "conversionsActives" INTEGER NOT NULL DEFAULT -1;
