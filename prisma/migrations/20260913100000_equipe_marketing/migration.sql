-- Notes des spécialistes marketing.
--
-- Trois métiers différents — le social, le référencement, la lecture des résultats —
-- regardent le même projet sans se parler. Ce qui les relie tient en une phrase : ce que
-- chacun retient de son passage, et que les autres reçoivent la fois suivante. C'est là
-- toute la fonction « équipe » : pas un quatrième interlocuteur, mais une mémoire partagée
-- entre les trois.
--
-- Rien n'y est inventé. Chaque note est la réponse réellement donnée à une question
-- réellement posée, avec son coût en crédits, pour que le créateur sache ce qu'il dépense.

CREATE TABLE "AgentNote" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "projectId"    UUID NOT NULL,
  -- Spécialiste : 'social', 'seo' ou 'analytics'. Texte plutôt qu'énumération, pour qu'un
  -- métier de plus n'impose pas une migration de type.
  "agent"        TEXT NOT NULL,
  "question"     TEXT NOT NULL,
  "answer"       TEXT NOT NULL,
  -- Ce que le spécialiste retient pour ses collègues, en une phrase.
  "takeaway"     TEXT,
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentNote_projectId_createdAt_idx" ON "AgentNote" ("projectId", "createdAt");
CREATE INDEX "AgentNote_projectId_agent_createdAt_idx"
  ON "AgentNote" ("projectId", "agent", "createdAt");

ALTER TABLE "AgentNote"
  ADD CONSTRAINT "AgentNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentNote"
  ADD CONSTRAINT "AgentNote_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Cloisonnement ────────────────────────────────
ALTER TABLE "AgentNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY agentnote_owner ON "AgentNote" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AgentNote" TO appforge_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AgentNote" TO evoliia_app;
  END IF;
END
$$;
