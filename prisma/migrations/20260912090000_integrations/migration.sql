-- Gestionnaire d'intégrations.
--
-- Trois tables, une intention par table :
--   - IntegrationConnection : ce qui est affiché au créateur. Aucun secret.
--   - IntegrationCredential : les secrets, chiffrés. Lue uniquement au moment d'appeler
--     le fournisseur, jamais pour afficher une liste.
--   - IntegrationEvent      : le journal, sans jeton ni clé.
--
-- Les trois sont soumises au Row Level Security au même titre que les projets : une
-- connexion appartient à un créateur et à lui seul.

CREATE TYPE "IntegrationTarget" AS ENUM ('EVOLIIA', 'APP');
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');
CREATE TYPE "CredentialKind" AS ENUM ('OAUTH', 'API_KEY');

CREATE TABLE "IntegrationConnection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "providerId" TEXT NOT NULL,
  "target" "IntegrationTarget" NOT NULL DEFAULT 'EVOLIIA',
  "projectId" UUID,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "accountLabel" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "disconnectedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationConnection_userId_providerId_target_projectId_key"
  ON "IntegrationConnection" ("userId", "providerId", "target", "projectId");
CREATE INDEX "IntegrationConnection_userId_status_idx"
  ON "IntegrationConnection" ("userId", "status");

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationCredential" (
  "connectionId" UUID NOT NULL,
  "kind" "CredentialKind" NOT NULL,
  "secret" TEXT NOT NULL,
  "refreshSecret" TEXT,
  "hint" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("connectionId")
);

ALTER TABLE "IntegrationCredential"
  ADD CONSTRAINT "IntegrationCredential_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "connectionId" UUID,
  "providerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationEvent_userId_createdAt_idx"
  ON "IntegrationEvent" ("userId", "createdAt");

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Connexions autorisées par offre. Zéro par défaut : aucune offre ne promet quoi que ce
-- soit tant que le premier connecteur n'existe pas.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxConnections" INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────── Cloisonnement ────────────────────────────────
ALTER TABLE "IntegrationConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY integrationconnection_owner ON "IntegrationConnection" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "IntegrationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY integrationevent_owner ON "IntegrationEvent" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

-- Les secrets suivent leur connexion : accessibles seulement si elle l'est.
ALTER TABLE "IntegrationCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationCredential" FORCE ROW LEVEL SECURITY;
CREATE POLICY integrationcredential_owner ON "IntegrationCredential" FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "IntegrationConnection" c
      WHERE c."id" = "IntegrationCredential"."connectionId"
        AND c."userId" = app_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "IntegrationConnection" c
      WHERE c."id" = "IntegrationCredential"."connectionId"
        AND c."userId" = app_current_user_id()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "IntegrationConnection", "IntegrationCredential", "IntegrationEvent"
      TO appforge_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "IntegrationConnection", "IntegrationCredential", "IntegrationEvent"
      TO evoliia_app;
  END IF;
END
$$;
