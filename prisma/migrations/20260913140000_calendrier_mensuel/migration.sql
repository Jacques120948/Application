-- Le mois, à côté de la semaine.
--
-- Une colonne dans le kit plutôt qu'une table à part : le mois n'est pas un autre kit, c'est
-- le même — mêmes angles, même marque, même proposition de valeur — prolongé de trois
-- semaines. Une seconde table aurait obligé à les tenir synchronisés, et à répondre à la
-- question « lequel fait foi » à chaque écran.
--
-- Nullable : un kit sans mois est le cas normal, le mois n'est préparé que sur demande et
-- seulement par les offres qui l'ouvrent.

ALTER TABLE "MarketingKit" ADD COLUMN IF NOT EXISTS "month" JSONB;
