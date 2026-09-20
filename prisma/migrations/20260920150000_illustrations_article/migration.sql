-- Les photos d'un article viennent de la boutique, pas d'un modèle.
--
-- Le rédacteur décrit ce qu'il voudrait montrer ; le serveur cherche la fiche qui
-- correspond et fournit l'adresse réelle. Un modèle à qui l'on demande une URL en invente
-- une : elle a la bonne forme, elle ne mène nulle part, et l'article part chez le client
-- avec des images cassées. Aucune adresse ne traverse donc le modèle.
--
-- Ce qui est conservé est une référence, jamais une copie : les adresses pointent les
-- images que la boutique sert déjà. Evoliia ne stocke aucune image, n'en paie aucune, et
-- l'article se copie tel quel dans la boutique où ces images vivent.

ALTER TABLE "SiteArticle" ADD COLUMN "illustrations" JSONB;
