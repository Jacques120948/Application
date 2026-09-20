-- Un article déposé dans Shopify porte sa trace.
--
-- Evoliia dépose un brouillon ; le marchand le relit chez lui et le publie lui-même. Une
-- intelligence artificielle qui publie seule sur une boutique marchande, c'est le jour où
-- elle publie une bêtise et où son propriétaire l'apprend par un client.
--
-- L'identifiant conservé sert à une chose : empêcher un second dépôt. Sans lui, un clic de
-- trop créerait un doublon dans la boutique — et le contenu dupliqué est précisément ce que
-- l'analyse reproche ensuite au site.

ALTER TABLE "SiteArticle" ADD COLUMN "shopifyId" TEXT;
ALTER TABLE "SiteArticle" ADD COLUMN "shopifyUrl" TEXT;
ALTER TABLE "SiteArticle" ADD COLUMN "shopifyAt" TIMESTAMP(3);
