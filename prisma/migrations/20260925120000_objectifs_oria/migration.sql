-- Les objectifs de l'entreprise, qu'Oria lit pour classer ses priorités.
--
-- Deux colonnes sur le site plutôt qu'une table : un objectif est une propriété de
-- l'activité, et l'activité est ici le site — c'est déjà lui qui porte « ce que fait
-- l'entreprise ». Une table de plus aurait demandé sa propre politique d'isolation pour
-- deux valeurs ; le site a déjà la sienne, et elle s'applique d'office.
--
-- Vides par défaut : sans objectif déclaré, le classement reste neutre. On ne suppose pas
-- que tout le monde veut des ventes.
ALTER TABLE "Site" ADD COLUMN "objectifs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Site" ADD COLUMN "activite" TEXT NOT NULL DEFAULT '';
