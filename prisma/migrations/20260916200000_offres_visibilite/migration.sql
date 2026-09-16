-- Ce qu'une offre accorde dans le produit de visibilité.
--
-- Trois nombres, et ils ont la même raison d'être que les quotas déjà présents : borner ce
-- qui grandirait avec l'usage plutôt qu'avec le nombre de clients. Un audit n'est pas du
-- calcul gratuit — c'est un parcours réel de pages sur le réseau, à la charge d'Evoliia.
--
-- Zéro par défaut, comme pour les images et les alertes. Une offre souscrite avant ce jour
-- ne doit pas se mettre à promettre un produit qui n'existait pas alors, et une fonction
-- qui coûte ne s'ouvre jamais toute seule : c'est l'exploitant qui décide, offre par offre.

ALTER TABLE "Plan" ADD COLUMN "sitesMax" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "pagesPerAudit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "auditsPerMonth" INTEGER NOT NULL DEFAULT 0;
