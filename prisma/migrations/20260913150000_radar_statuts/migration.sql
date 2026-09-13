-- Deux statuts de plus pour une idée, et rien d'autre dans cette migration.
--
-- Une valeur ajoutée à une énumération ne peut pas servir dans la transaction qui l'ajoute :
-- Postgres le refuse. Les colonnes et les tables qui en dépendent viennent donc dans la
-- migration suivante, et celle-ci ne fait qu'élargir le vocabulaire.
--
-- SAVED : l'idée est mise de côté par le créateur. Ni retenue, ni écartée : gardée.
-- ARCHIVED : sortie de la vue courante sans être écartée. Un « pas maintenant ».
--
-- Les autres états du Radar existent déjà sous d'autres noms — PROPOSED est « nouvelle »,
-- SELECTED est « transformée en projet » (elle porte le lien vers lui), DISCARDED est
-- « rejetée ». Inventer un second vocabulaire aurait obligé chaque écran à traduire.

ALTER TYPE "IdeaStatus" ADD VALUE IF NOT EXISTS 'SAVED';
ALTER TYPE "IdeaStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
