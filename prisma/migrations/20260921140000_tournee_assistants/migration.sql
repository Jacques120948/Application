-- Le relevé de visibilité dans les assistants, dans la tournée.
--
-- Hebdomadaire et non quotidien, pour deux raisons. La demande ne bouge pas d'un jour à
-- l'autre : ce qu'un assistant répond lundi et mardi est la même chose, à son aléa près, et
-- payer sept fois pour une information qui change au mois est une dépense sans contrepartie.
-- Et l'accumulation suffit : deux relevés par question et par semaine font vingt-six
-- mesures par trimestre, largement de quoi voir une tendance.
--
-- `assistantsAt` porte la cadence. Le planificateur passe chaque nuit et regarde cette date :
-- un planificateur mal réglé, ou rappelé deux fois, ne peut donc pas facturer deux fois.

ALTER TABLE "SiteAutomatisation" ADD COLUMN "assistants" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteAutomatisation" ADD COLUMN "assistantsAt" TIMESTAMP(3);
