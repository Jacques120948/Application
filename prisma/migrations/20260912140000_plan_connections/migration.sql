-- Ouverture du premier connecteur : la clé Anthropic du créateur.
--
-- Le semis n'écrase plus les réglages d'offre, pour ne pas effacer à chaque déploiement ce
-- que l'exploitant a changé dans son administration. Relever le plafond de connexions se
-- fait donc ici, une fois, et seulement là où il vaut encore zéro — c'est-à-dire là où
-- personne n'y a touché.

UPDATE "Plan" SET "maxConnections" = 1  WHERE "id" = 'launch'   AND "maxConnections" = 0;
UPDATE "Plan" SET "maxConnections" = 3  WHERE "id" = 'builder'  AND "maxConnections" = 0;
UPDATE "Plan" SET "maxConnections" = 10 WHERE "id" = 'business' AND "maxConnections" = 0;
