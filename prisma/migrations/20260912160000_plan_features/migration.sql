-- Droits par abonnement, stockés sur l'offre.
--
-- Jusqu'ici une fonction payante se traduisait par une colonne booléenne de plus sur
-- `Plan`. Cela ne tient plus dès qu'il y en a une dizaine, et surtout cela oblige à une
-- migration pour déplacer une fonction d'une offre à l'autre — c'est-à-dire pour une
-- décision commerciale. La liste de fonctions se modifie depuis le back-office.

ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "features" TEXT[] NOT NULL DEFAULT '{}';

-- Répartition de départ, posée une seule fois : seulement là où rien n'a encore été
-- décidé, pour ne pas écraser un réglage de l'exploitant à la migration suivante.
UPDATE "Plan" SET "features" = ARRAY['social_launch_basic','social_angles','social_week']
  WHERE "id" = 'launch' AND cardinality("features") = 0;

UPDATE "Plan" SET "features" = ARRAY[
    'social_launch_basic','social_angles','social_week',
    'social_calendar','social_content_generation','social_agent','social_analytics_basic'
  ] WHERE "id" = 'builder' AND cardinality("features") = 0;

UPDATE "Plan" SET "features" = ARRAY[
    'social_launch_basic','social_angles','social_week',
    'social_calendar','social_content_generation','social_agent','social_analytics_basic',
    'marketing_team','seo_agent','analytics_agent'
  ] WHERE "id" = 'business' AND cardinality("features") = 0;
