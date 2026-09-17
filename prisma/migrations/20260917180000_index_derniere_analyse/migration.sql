-- « La dernière analyse terminée de ce site » est la première requête de presque tout
-- l'écran de visibilité : le tableau de bord, le plan d'action, l'historique et chaque
-- question posée à l'équipe commencent par elle. Les index existants portaient sur
-- `startedAt`, alors que le tri se fait sur `finishedAt` et le filtre sur `status` : chaque
-- chargement d'écran balayait donc toutes les analyses du site.
--
-- Invisible à dix audits. À quarante par mois et par site, sur mille sites, c'est la requête
-- qui décide si le produit tient.

CREATE INDEX "Audit_siteId_status_finishedAt_idx" ON "Audit" ("siteId", "status", "finishedAt");
