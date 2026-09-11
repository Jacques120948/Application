-- Réglages de l'installation.
--
-- L'identité légale de l'exploitant y est stockée : elle change d'une installation à
-- l'autre et ne peut donc pas vivre dans le code. Table publique en lecture, écriture
-- réservée au back-office par le code applicatif.
CREATE TABLE IF NOT EXISTS "SiteSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteSetting" TO appforge_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteSetting" TO evoliia_app;
  END IF;
END
$$;
