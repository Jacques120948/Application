-- Les résumés d'Oria : ce qu'elle voit aujourd'hui, ou ce qu'a donné la semaine.
--
-- Conservés parce qu'ils sont payés. Le cockpit se recharge dix fois par jour ; un résumé
-- régénéré à chaque ouverture coûterait dix fois, pour dire dix fois la même chose. On
-- l'écrit sur demande, on le garde, et on le relit gratuitement.
--
-- Le site est facultatif : quelqu'un qui n'a relié qu'un compte publicitaire a déjà de
-- quoi être résumé, sans avoir analysé de site.
CREATE TABLE "OriaResume" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "siteId"       UUID,
  "genre"        TEXT NOT NULL,
  "texte"        TEXT NOT NULL,
  -- Les faits transmis au modèle, tels quels : relire un résumé de mars sans savoir sur quoi
  -- il reposait reviendrait à le croire sur parole.
  "fondement"    JSONB NOT NULL DEFAULT '{}',
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OriaResume_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OriaResume_userId_genre_createdAt_idx" ON "OriaResume" ("userId", "genre", "createdAt" DESC);

ALTER TABLE "OriaResume"
  ADD CONSTRAINT "OriaResume_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OriaResume"
  ADD CONSTRAINT "OriaResume_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolée comme les autres : chacun ne lit et n'écrit que ses propres résumés.
ALTER TABLE "OriaResume" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OriaResume" FORCE ROW LEVEL SECURITY;
CREATE POLICY oriaresume_owner ON "OriaResume" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "OriaResume" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
