-- La visibilité dans les assistants, mesurée plutôt que promise.
--
-- Evoliia répète depuis le début qu'un bon score GEO ne garantit aucune apparition dans un
-- assistant. C'est vrai, et c'était jusqu'ici un aveu d'impuissance : le produit disait ce
-- qu'il ne pouvait pas savoir sans jamais aller le chercher. Poser la question à
-- l'assistant et lire sa réponse est la seule façon honnête de le savoir.
--
-- Deux tables.
--
-- `PromptIA` garde les questions qu'un client pourrait poser et où la marque devrait
-- apparaître. Elles sont écrites par la personne : elle connaît son marché, et une question
-- inventée par un modèle mesurerait l'imagination du modèle.
--
-- `ReleveIA` garde une réponse par question, par plateforme et par passage. Une seule
-- lecture ne vaut rien — ces réponses ne sont pas déterministes, et la même question posée
-- deux fois donne deux réponses. C'est l'accumulation qui fait le chiffre : « vue dans 3
-- relevés sur 10 » est une fréquence, « vue » serait un mensonge.

CREATE TABLE "PromptIA" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"    UUID NOT NULL,
  "userId"    UUID NOT NULL,

  -- La question, telle qu'un client la poserait. Dans sa langue.
  "texte"     TEXT NOT NULL,
  -- Le regroupement choisi par la personne : « Conseils », « Produits », « Confiance »…
  "theme"     TEXT NOT NULL DEFAULT '',
  -- Une question éteinte reste là avec son historique, et cesse d'être posée et facturée.
  "actif"     BOOLEAN NOT NULL DEFAULT true,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PromptIA_pkey" PRIMARY KEY ("id")
);

-- La même question deux fois doublerait la facture pour une seule information.
CREATE UNIQUE INDEX "PromptIA_siteId_texte_key" ON "PromptIA" ("siteId", "texte");
CREATE INDEX "PromptIA_siteId_actif_idx" ON "PromptIA" ("siteId", "actif");

ALTER TABLE "PromptIA" ADD CONSTRAINT "PromptIA_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptIA" ADD CONSTRAINT "PromptIA_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReleveIA" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "promptId"   UUID NOT NULL,
  "siteId"     UUID NOT NULL,
  "userId"     UUID NOT NULL,

  -- gemini | claude | perplexity. Le nom de la plateforme réellement interrogée, jamais
  -- celui d'une plateforme approchante : dire « ChatGPT » en mesurant autre chose serait
  -- faux, et c'est exactement ce que ce produit refuse.
  "plateforme" TEXT NOT NULL,
  -- La marque apparaît-elle dans la réponse. Constaté sur le texte, pas déduit.
  "mentionne"  BOOLEAN NOT NULL DEFAULT false,
  -- bon | neutre | reserve | inconnu. Seulement quand la marque est mentionnée.
  "sentiment"  TEXT NOT NULL DEFAULT 'inconnu',
  -- Le passage où la marque apparaît, pour que la personne puisse vérifier elle-même.
  "extrait"    TEXT NOT NULL DEFAULT '',
  -- Les adresses citées par l'assistant. C'est là que se voit qui il a lu.
  "sources"    JSONB NOT NULL DEFAULT '[]'::jsonb,

  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReleveIA_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReleveIA_promptId_createdAt_idx" ON "ReleveIA" ("promptId", "createdAt" DESC);
CREATE INDEX "ReleveIA_siteId_createdAt_idx" ON "ReleveIA" ("siteId", "createdAt" DESC);

ALTER TABLE "ReleveIA" ADD CONSTRAINT "ReleveIA_promptId_fkey"
  FOREIGN KEY ("promptId") REFERENCES "PromptIA" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleveIA" ADD CONSTRAINT "ReleveIA_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleveIA" ADD CONSTRAINT "ReleveIA_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cloisonnement. Savoir sur quelles questions un concurrent est cité, et lesquelles il
-- surveille, vaut cher. `FORCE` est indispensable — sans lui, le propriétaire des tables
-- contournerait ses propres règles, et c'est lui qui exécute les migrations.

ALTER TABLE "PromptIA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptIA" FORCE ROW LEVEL SECURITY;
CREATE POLICY promptia_owner ON "PromptIA" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "ReleveIA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleveIA" FORCE ROW LEVEL SECURITY;
CREATE POLICY releveia_owner ON "ReleveIA" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PromptIA" TO appforge_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ReleveIA" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
