-- Ce dont les contrôles ont besoin, et que l'exploration savait sans le garder.
--
-- `siteSignals` retient ce qui ne s'observe qu'une fois pour le site : l'existence d'un
-- robots.txt, celle d'un plan de site, ce qu'ils autorisent. Ces faits ne sont connus qu'au
-- moment où l'accueil est visité, c'est-à-dire à la première tranche ; les contrôles, eux,
-- tournent à la dernière. Sans cette colonne, l'information était perdue entre les deux.
--
-- `redirects` compte les sauts traversés pour atteindre une page. Chacun coûte un
-- aller-retour au visiteur et dilue ce que le moteur attribue à l'adresse finale.

ALTER TABLE "Audit" ADD COLUMN "siteSignals" JSONB;
ALTER TABLE "AuditPage" ADD COLUMN "redirects" INTEGER NOT NULL DEFAULT 0;
