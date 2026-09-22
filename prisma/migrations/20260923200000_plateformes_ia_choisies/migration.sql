-- Choisir les assistants qu'on veut suivre, et ne payer que ceux-là.
--
-- Jusqu'ici la liste des plateformes interrogées était une décision d'Evoliia : toutes
-- celles dont la clé était posée, pour un prix forfaitaire à la question. C'était tenable à
-- trois plateformes. Ça ne l'est plus dès qu'on en ajoute, pour deux raisons opposées et
-- également gênantes.
--
-- Côté client, il paie le même prix qu'on interroge trois assistants ou six, sans avoir rien
-- demandé ni rien pu refuser. Côté Evoliia, chaque plateforme ajoutée est prise sur la
-- marge et se multiplie par le nombre de comptes — c'est-à-dire qu'un ajout gratuit pour
-- nous n'existe pas, et qu'une facture d'API qui double ne se voit qu'au relevé bancaire.
--
-- La colonne rend donc la liste explicite et propre à chaque site. Vide, elle vaut « toutes
-- celles qui sont disponibles » : c'est exactement le comportement d'aujourd'hui, et aucun
-- site existant ne change d'état ni de prix au déploiement.
--
-- Un tableau de texte plutôt qu'une table de liaison : ce sont trois ou quatre valeurs, lues
-- toujours ensemble et jamais jointes. Une table aurait coûté une requête de plus par
-- passage pour ranger ce qui tient dans une colonne.

ALTER TABLE "SiteAutomatisation"
  ADD COLUMN "plateformesIA" TEXT[] NOT NULL DEFAULT '{}'::text[];
