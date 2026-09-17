-- Les corrections rédigées par l'IA.
--
-- Elles sont enregistrées et non rendues une fois : elles ont coûté des crédits, et un texte
-- payé qui disparaît au rechargement de la page est un texte volé. L'unicité porte sur le
-- quadruplet site / contrôle / page / champ : relancer la rédaction remplace la proposition
-- précédente au lieu d'en empiler dix, et l'écran n'a jamais à choisir laquelle montrer.

CREATE TABLE "AuditCorrection" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"       UUID NOT NULL,
  "userId"       UUID NOT NULL,
  "checkId"      TEXT NOT NULL,
  "path"         TEXT NOT NULL,
  "url"          TEXT NOT NULL DEFAULT '',
  "field"        TEXT NOT NULL,
  "before"       TEXT NOT NULL DEFAULT '',
  "after"        TEXT NOT NULL,
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditCorrection_siteId_checkId_path_field_key"
  ON "AuditCorrection" ("siteId", "checkId", "path", "field");
CREATE INDEX "AuditCorrection_siteId_checkId_idx" ON "AuditCorrection" ("siteId", "checkId");

ALTER TABLE "AuditCorrection" ADD CONSTRAINT "AuditCorrection_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditCorrection" ADD CONSTRAINT "AuditCorrection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cloisonnement. La table porte l'identifiant de la personne : elle se compare directement à
-- la session en cours. `FORCE` est indispensable — sans lui, le propriétaire des tables
-- contournerait ses propres règles, et c'est précisément lui qui exécute les migrations.

ALTER TABLE "AuditCorrection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditCorrection" FORCE ROW LEVEL SECURITY;
CREATE POLICY auditcorrection_owner ON "AuditCorrection" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- L'octroi est conditionnel, comme dans toutes les migrations qui l'ont précédé : le rôle
-- existe sur une installation montée avec scripts/setup-db.sql, et pas sur une base gérée où
-- l'application se connecte autrement. Un GRANT inconditionnel échoue alors — et une
-- migration en échec bloque toutes les suivantes, donc tous les déploiements.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditCorrection" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
