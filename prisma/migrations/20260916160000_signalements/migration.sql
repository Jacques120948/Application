/*
 * Deux chemins entre un créateur et l'exploitant.
 *
 * Jusqu'ici il n'en existait aucun. Un créateur bloqué par une panne n'avait rien pour le
 * dire, et les demandes que l'assistant refusait étaient jetées à mesure — alors que ce sont
 * les deux informations dont un produit naissant a le plus besoin.
 *
 * **Un signalement** est ce qu'écrit quelqu'un que l'agent n'a pas pu dépanner. Il part avec
 * les faits que l'exploitant aurait dû demander — écran, projet, offre, crédits, échecs
 * récents — pour éviter trois allers-retours avant de comprendre.
 *
 * **Une demande sans suite** est une demande à laquelle l'assistant n'a rien changé. Comptées,
 * elles forment la feuille de route écrite par les créateurs plutôt que devinée.
 *
 * Aucune des deux tables ne porte de Row Level Security, comme AiUsage et pour la même
 * raison : elles n'existent que pour être lues par l'exploitant, et aucun écran de créateur
 * ne les relit. Une table qu'on ne lit jamais par erreur n'a pas besoin qu'on l'empêche de
 * mal la lire. L'écriture, elle, tient toujours son identifiant de la session, jamais du
 * navigateur.
 */

CREATE TABLE "CreatorReport" (
  "id"        UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "projectId" UUID,
  "screen"    TEXT NOT NULL,
  "message"   TEXT NOT NULL,
  "context"   TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'open',
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorReport_pkey" PRIMARY KEY ("id")
);

-- Ce qui est ouvert d'abord, et le plus récent en tête : c'est l'unique tri de l'écran.
CREATE INDEX "CreatorReport_status_createdAt_idx" ON "CreatorReport"("status", "createdAt");

ALTER TABLE "CreatorReport"
  ADD CONSTRAINT "CreatorReport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UnmetRequest" (
  "id"        UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "request"   TEXT NOT NULL,
  "reply"     TEXT NOT NULL,
  "explicit"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnmetRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnmetRequest_explicit_createdAt_idx" ON "UnmetRequest"("explicit", "createdAt");

ALTER TABLE "UnmetRequest"
  ADD CONSTRAINT "UnmetRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CreatorReport", "UnmetRequest" TO appforge_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CreatorReport", "UnmetRequest" TO evoliia_app;
  END IF;
END $$;
