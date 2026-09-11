-- Monnaie du créateur et de ses idées.
--
-- Les montants du parcours (objectif, prix conseillés, coûts) sont exprimés dans cette
-- monnaie sans jamais être convertis : une conversion supposerait un taux de change, donc
-- un chiffre non vérifié affiché sur un sujet financier.
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EUR';

-- La monnaie est figée sur l'idée à sa création. Changer de monnaie plus tard ne doit pas
-- réétiqueter des prix pensés pour un autre marché.
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EUR';
