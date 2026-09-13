-- L'export et la préparation mobile existent : les offres peuvent les ouvrir.
--
-- Ces deux cases étaient cochées nulle part, parce que rien ne les mettait en œuvre. Elles
-- le sont désormais : l'export produit un dossier de pages qui s'ouvre sans serveur, la
-- préparation mobile un dossier de publication avec les icônes et les textes de fiche.
--
-- L'export ouvre dès Builder : c'est une garantie de réversibilité, et elle a sa place dès
-- qu'on paie pour plusieurs projets. La préparation mobile reste sur Business, où elle
-- accompagne les projets assez avancés pour viser une boutique.
--
-- Comme toujours, ce n'est qu'une valeur de départ : le back-office reste maître.

UPDATE "Plan" SET "allowExport" = true WHERE "id" IN ('builder', 'business');
UPDATE "Plan" SET "allowMobilePrep" = true WHERE "id" = 'business';
