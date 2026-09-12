-- Trace du dépôt d'une semaine dans l'espace social du créateur.
--
-- Sert à l'afficher, pas à bloquer : un second envoi du même kit ne crée pas de doublon,
-- la clé d'idempotence côté Postelya s'en charge. Empêcher le renvoi priverait le créateur
-- d'un moyen simple de réparer un dépôt à moitié abouti.

ALTER TABLE "MarketingKit" ADD COLUMN IF NOT EXISTS "sentToSocialAt" TIMESTAMP(3);
