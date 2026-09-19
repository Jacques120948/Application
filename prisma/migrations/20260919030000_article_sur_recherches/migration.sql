-- L'article se fonde sur la demande, quand on la connaît.
--
-- Jusqu'ici le sujet d'un article était choisi à partir de ce que l'analyse reprochait au
-- site : c'est honnête quand on n'a rien d'autre, et faible quand on a mieux. Avec Search
-- Console relié, le rédacteur reçoit ce que les gens ont réellement tapé pour voir ce site.
--
-- Les recherches retenues sont conservées avec l'article. Sans elles, on relirait dans un an
-- un texte dont on ne saurait plus s'il a été écrit sur une demande mesurée ou sur une
-- déduction — et ce n'est pas la même valeur. Vide quand aucune source n'était disponible :
-- l'absence se lit alors, au lieu de se supposer.

ALTER TABLE "SiteArticle" ADD COLUMN "recherches" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
