-- Sites suivis et audits de visibilité.
--
-- Cinq tables, toutes strictement personnelles : un utilisateur ne doit jamais pouvoir
-- atteindre le site d'un autre, ni ses audits, ni ses constats, ni son plan d'action. Le
-- cloisonnement est posé au niveau de la base, comme partout ailleurs, et non dans le code
-- applicatif : une requête oubliée ne doit pas pouvoir devenir une fuite.
--
-- Deux d'entre elles — les pages visitées et les constats — n'ont pas de colonne
-- « utilisateur ». Leur politique passe donc par l'audit auquel elles appartiennent : c'est
-- plus sûr que de recopier l'identifiant, qui pourrait diverger.

CREATE TABLE "Site" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "origin"    TEXT NOT NULL,
  "host"      TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "about"     TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Site_userId_host_key" ON "Site" ("userId", "host");
CREATE INDEX "Site_userId_updatedAt_idx" ON "Site" ("userId", "updatedAt");
ALTER TABLE "Site" ADD CONSTRAINT "Site_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Audit" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"       UUID NOT NULL,
  "userId"       UUID NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "trigger"      TEXT NOT NULL DEFAULT 'manual',
  "maxPages"     INTEGER NOT NULL DEFAULT 50,
  "maxDepth"     INTEGER NOT NULL DEFAULT 3,
  "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
  "pagesSkipped" INTEGER NOT NULL DEFAULT 0,
  "seoScore"     INTEGER,
  "geoScore"     INTEGER,
  "errorCode"    TEXT,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"   TIMESTAMP(3),
  CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Audit_siteId_startedAt_idx" ON "Audit" ("siteId", "startedAt");
CREATE INDEX "Audit_userId_startedAt_idx" ON "Audit" ("userId", "startedAt");
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditPage" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "auditId"     UUID NOT NULL,
  "url"         TEXT NOT NULL,
  "path"        TEXT NOT NULL,
  "depth"       INTEGER NOT NULL DEFAULT 0,
  "statusCode"  INTEGER NOT NULL DEFAULT 0,
  "bytes"       INTEGER NOT NULL DEFAULT 0,
  "fetchMs"     INTEGER NOT NULL DEFAULT 0,
  "title"       TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "wordCount"   INTEGER NOT NULL DEFAULT 0,
  "signals"     JSONB NOT NULL,
  CONSTRAINT "AuditPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPage_auditId_url_key" ON "AuditPage" ("auditId", "url");
CREATE INDEX "AuditPage_auditId_depth_idx" ON "AuditPage" ("auditId", "depth");
ALTER TABLE "AuditPage" ADD CONSTRAINT "AuditPage_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditFinding" (
  "id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "auditId"  UUID NOT NULL,
  "checkId"  TEXT NOT NULL,
  "engine"   TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "affected" INTEGER NOT NULL DEFAULT 0,
  "examined" INTEGER NOT NULL DEFAULT 0,
  "weight"   INTEGER NOT NULL DEFAULT 0,
  "lost"     INTEGER NOT NULL DEFAULT 0,
  "sample"   JSONB NOT NULL,
  CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditFinding_auditId_checkId_key" ON "AuditFinding" ("auditId", "checkId");
CREATE INDEX "AuditFinding_auditId_engine_lost_idx" ON "AuditFinding" ("auditId", "engine", "lost");
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActionItem" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"    UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "checkId"   TEXT NOT NULL,
  "state"     TEXT NOT NULL DEFAULT 'todo',
  "note"      TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActionItem_siteId_checkId_key" ON "ActionItem" ("siteId", "checkId");
CREATE INDEX "ActionItem_userId_state_idx" ON "ActionItem" ("userId", "state");
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cloisonnement.
--
-- Les trois tables qui portent l'identifiant de la personne se comparent directement à la
-- session en cours. `FORCE` est indispensable : sans lui, le propriétaire des tables
-- contournerait ses propres règles, et c'est précisément lui qui exécute les migrations.

ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Site" FORCE ROW LEVEL SECURITY;
CREATE POLICY site_owner ON "Site" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "Audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Audit" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_owner ON "Audit" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "ActionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActionItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY actionitem_owner ON "ActionItem" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- Les deux tables sans colonne « utilisateur » passent par leur audit. Recopier
-- l'identifiant aurait été plus simple à écrire et plus facile à faire diverger : une ligne
-- insérée avec le mauvais identifiant deviendrait invisible à son propriétaire et visible à
-- un autre. En interrogeant l'audit, il n'existe qu'une seule vérité.

ALTER TABLE "AuditPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditPage" FORCE ROW LEVEL SECURITY;
CREATE POLICY auditpage_owner ON "AuditPage" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Audit" a
    WHERE a."id" = "AuditPage"."auditId" AND a."userId" = app_current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Audit" a
    WHERE a."id" = "AuditPage"."auditId" AND a."userId" = app_current_user_id()
  ));

ALTER TABLE "AuditFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditFinding" FORCE ROW LEVEL SECURITY;
CREATE POLICY auditfinding_owner ON "AuditFinding" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Audit" a
    WHERE a."id" = "AuditFinding"."auditId" AND a."userId" = app_current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Audit" a
    WHERE a."id" = "AuditFinding"."auditId" AND a."userId" = app_current_user_id()
  ));

-- Le rôle applicatif n'a que ce qu'il lui faut, et il est soumis aux politiques ci-dessus.
--
-- L'octroi est conditionnel, comme dans toutes les migrations qui l'ont précédé, et pour une
-- raison apprise ici : le rôle existe sur une installation montée avec scripts/setup-db.sql,
-- et pas sur une base gérée où l'application se connecte autrement. Un GRANT inconditionnel
-- échoue alors — et une migration en échec bloque toutes les suivantes, donc tous les
-- déploiements, jusqu'à ce que quelqu'un aille la débloquer à la main.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "Site", "Audit", "AuditPage", "AuditFinding", "ActionItem" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
