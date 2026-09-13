-- Radar d'opportunités et Lia, l'assistante de support des applications créées.
--
-- Deux modules, une même règle : rien de ce qui existe n'est reconstruit. Le Radar prolonge
-- la table des idées, qui est déjà une opportunité structurée (score, demande, concurrence,
-- complexité, risques, lien vers le projet). Lia prolonge l'assistant intégré aux
-- applications, en lui donnant ce qui lui manquait : une base de connaissances, la faculté
-- de dire « je ne sais pas », et un guichet pour transmettre.
--
-- Trois précautions valent pour tout le fichier.
--
-- Aucune migration destructive : des colonnes ajoutées avec valeur par défaut, des tables
-- nouvelles, jamais une suppression ni un changement de type.
--
-- Les offres ne bougent pas. Les quotas nouveaux prennent la valeur la plus prudente —
-- zéro pour Lia, une analyse pour le Radar — et les deux fonctions ne sont ajoutées à
-- aucune offre : c'est l'exploitant qui décide, depuis le back-office.
--
-- Le cloisonnement est le même qu'ailleurs. Le créateur voit ses lignes par sa propre
-- identité ; les visiteurs d'une application publiée n'atteignent que celles de ce projet,
-- par la portée d'exécution, et uniquement là où c'est nécessaire.

-- ═══════════════════════════════ Radar ════════════════════════════════════

-- Ce que le Radar ajoute à une idée : d'où elle vient, pourquoi elle est proposée, et le
-- détail du score pour qu'il ne soit plus une boîte noire.
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'parcours';
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "runId" UUID;
-- Les raisons de la proposition, phrases lisibles : « Vous avez 12 ans dans ce secteur ».
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "fitReasons" JSONB;
-- Les cinq composantes du score, sur dix, telles que pondérées par la plateforme.
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "subScores" JSONB;
-- Empreinte lexicale servant à ne pas reproposer la même idée sous un autre titre.
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "savedAt" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Idea_userId_status_createdAt_idx" ON "Idea" ("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Idea_userId_fingerprint_idx" ON "Idea" ("userId", "fingerprint");
CREATE INDEX IF NOT EXISTS "Idea_runId_idx" ON "Idea" ("runId");

-- Ce que le profil n'avait pas encore, et que le Radar peut exploiter. Tout est facultatif :
-- rien n'est redemandé, et une personne qui ne répond pas garde des recommandations
-- valables, simplement moins fines.
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "experienceYears" INTEGER;
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "knownSectors" TEXT NOT NULL DEFAULT '';
-- debutant | intermediaire | avance
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "technicalLevel" TEXT NOT NULL DEFAULT 'debutant';
-- aucune | premiere | confirmee
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "entrepreneurExperience" TEXT NOT NULL DEFAULT 'aucune';
-- local | francophone | international
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "marketScope" TEXT NOT NULL DEFAULT 'francophone';
-- saas | application | outil_metier | marketplace | indifferent
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "productPreference" TEXT NOT NULL DEFAULT 'indifferent';
ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "willingToProspect" BOOLEAN;

-- Une recherche du Radar : ce qu'on savait de la personne à ce moment-là, et ce qu'elle a
-- coûté. C'est l'historique, et c'est aussi ce qui permet de ne pas relancer une analyse à
-- chaque affichage.
CREATE TABLE "RadarRun" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"          UUID NOT NULL,
  -- manual | scheduled | project
  "trigger"         TEXT NOT NULL DEFAULT 'manual',
  -- Projet de départ, quand la recherche cherche autour d'une application existante (V2).
  "projectId"       UUID,
  -- Le profil tel qu'il était : relire une recherche ancienne sans se tromper de contexte.
  "profileSnapshot" JSONB NOT NULL,
  "ideaCount"       INTEGER NOT NULL DEFAULT 0,
  "model"           TEXT NOT NULL DEFAULT '',
  "costMicros"      INTEGER NOT NULL DEFAULT 0,
  "creditsSpent"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RadarRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RadarRun_userId_createdAt_idx" ON "RadarRun" ("userId", "createdAt");
ALTER TABLE "RadarRun" ADD CONSTRAINT "RadarRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadarRun" ADD CONSTRAINT "RadarRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ce que le créateur pense d'une proposition. Deux verdicts et une raison facultative :
-- assez pour affiner les recherches suivantes, pas assez pour dresser un portrait.
CREATE TABLE "RadarFeedback" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "ideaId"    UUID NOT NULL,
  -- interested | not_for_me
  "verdict"   TEXT NOT NULL,
  -- too_complex | not_my_sector | too_competitive | too_expensive | no_b2b | other
  "reason"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RadarFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RadarFeedback_userId_createdAt_idx" ON "RadarFeedback" ("userId", "createdAt");
CREATE UNIQUE INDEX "RadarFeedback_userId_ideaId_key" ON "RadarFeedback" ("userId", "ideaId");
ALTER TABLE "RadarFeedback" ADD CONSTRAINT "RadarFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadarFeedback" ADD CONSTRAINT "RadarFeedback_ideaId_fkey"
  FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Signal extérieur observé (V2). Chaque ligne dit d'où elle vient, quand, et à quel point on
-- peut s'y fier. Sans ligne ici, la rubrique « pourquoi maintenant » reste une interprétation,
-- et l'écran le dit.
CREATE TABLE "RadarSignal" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Nul pour un signal commun à tous ; sinon propre à une personne.
  "userId"      UUID,
  "ideaId"      UUID,
  -- Identifiant de l'adaptateur : trends, news, public_data, marketplace…
  "source"      TEXT NOT NULL,
  -- search_trend | regulation | new_entrant | news | other
  "type"        TEXT NOT NULL,
  "url"         TEXT,
  "summary"     TEXT NOT NULL,
  -- 0 à 100. Une note de confiance déclarée par l'adaptateur, jamais par le modèle.
  "confidence"  INTEGER NOT NULL DEFAULT 50,
  "observedAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RadarSignal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RadarSignal_userId_observedAt_idx" ON "RadarSignal" ("userId", "observedAt");
CREATE INDEX "RadarSignal_ideaId_idx" ON "RadarSignal" ("ideaId");
ALTER TABLE "RadarSignal" ADD CONSTRAINT "RadarSignal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadarSignal" ADD CONSTRAINT "RadarSignal_ideaId_fkey"
  FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ════════════════════════════════ Lia ═════════════════════════════════════

-- Réglages de Lia pour une application. Une ligne par projet, créée à l'activation.
CREATE TABLE "SupportSettings" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"          UUID NOT NULL,
  "projectId"       UUID NOT NULL,
  "enabled"         BOOLEAN NOT NULL DEFAULT false,
  "displayName"     TEXT NOT NULL DEFAULT 'Lia',
  "greeting"        TEXT NOT NULL DEFAULT 'Bonjour 👋 Comment puis-je vous aider ?',
  -- bottom-right | bottom-left
  "position"        TEXT NOT NULL DEFAULT 'bottom-right',
  -- Couleur d'accent, hexadécimale. Nulle : celle du thème de l'application.
  "accentColor"     TEXT,
  -- Adresse où transmettre une demande que Lia ne sait pas traiter. Facultative.
  "escalationEmail" TEXT,
  -- Durée de conservation des conversations, en jours. Au-delà, elles sont purgées.
  "retentionDays"   INTEGER NOT NULL DEFAULT 90,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportSettings_projectId_key" ON "SupportSettings" ("projectId");
CREATE INDEX "SupportSettings_userId_idx" ON "SupportSettings" ("userId");
ALTER TABLE "SupportSettings" ADD CONSTRAINT "SupportSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportSettings" ADD CONSTRAINT "SupportSettings_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Base de connaissances : ce que Lia a le droit de dire.
--
-- Une seule table plutôt que sources, documents et fragments : en V1 chaque entrée est
-- courte — une question, sa réponse — et se retrouve par ses mots. Découper en fragments
-- n'a de sens que pour des documents longs, qui viendront avec la V2 et leurs vecteurs ;
-- la colonne `kind` garde la place de dire d'où vient chaque entrée.
CREATE TABLE "SupportKnowledgeEntry" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "projectId" UUID NOT NULL,
  -- manual | generated | spec
  "kind"      TEXT NOT NULL DEFAULT 'manual',
  "question"  TEXT NOT NULL,
  "answer"    TEXT NOT NULL,
  -- Mots servant à retrouver l'entrée, normalisés. Calculés à l'enregistrement.
  "keywords"  TEXT NOT NULL DEFAULT '',
  -- draft | published | disabled. Une entrée générée naît en brouillon : le propriétaire
  -- la relit avant qu'elle ne parle en son nom.
  "status"    TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportKnowledgeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportKnowledgeEntry_projectId_status_idx" ON "SupportKnowledgeEntry" ("projectId", "status");
CREATE INDEX "SupportKnowledgeEntry_userId_createdAt_idx" ON "SupportKnowledgeEntry" ("userId", "createdAt");
ALTER TABLE "SupportKnowledgeEntry" ADD CONSTRAINT "SupportKnowledgeEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportKnowledgeEntry" ADD CONSTRAINT "SupportKnowledgeEntry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une conversation entre un visiteur et Lia.
--
-- `visitorHash` relie les messages d'un même visiteur anonyme sans rien retenir de lui :
-- c'est une empreinte, pas une identité. Quand le visiteur est connecté à l'application,
-- `endUserId` le désigne.
CREATE TABLE "SupportConversation" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL,
  "projectId"     UUID NOT NULL,
  "endUserId"     UUID,
  "visitorHash"   TEXT NOT NULL,
  -- open | escalated | closed
  "status"        TEXT NOT NULL DEFAULT 'open',
  -- compte | connexion | abonnement | paiement | utilisation | bug | fonctionnalite |
  -- commercial | autre. Posée par Lia, jamais affichée au visiteur.
  "category"      TEXT,
  "messageCount"  INTEGER NOT NULL DEFAULT 0,
  -- Réponses où Lia disposait d'une source. Sert au taux de réponse automatique.
  "answeredCount" INTEGER NOT NULL DEFAULT 0,
  -- +1 utile, -1 pas utile, nul sans avis.
  "satisfaction"  INTEGER,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportConversation_projectId_createdAt_idx" ON "SupportConversation" ("projectId", "createdAt");
CREATE INDEX "SupportConversation_projectId_status_idx" ON "SupportConversation" ("projectId", "status");
CREATE INDEX "SupportConversation_projectId_visitorHash_idx" ON "SupportConversation" ("projectId", "visitorHash");
CREATE INDEX "SupportConversation_userId_createdAt_idx" ON "SupportConversation" ("userId", "createdAt");
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "AppEndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupportMessage" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId"      UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  -- visitor | lia | owner
  "role"           TEXT NOT NULL,
  "content"        TEXT NOT NULL,
  -- Vrai quand Lia s'est appuyée sur une entrée de la base ; faux quand elle a dit ne pas
  -- savoir. C'est la colonne qui nourrit « questions sans réponse ».
  "grounded"       BOOLEAN NOT NULL DEFAULT false,
  -- Identifiants des entrées utilisées, pour retrouver d'où vient une réponse.
  "sources"        JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage" ("conversationId", "createdAt");
CREATE INDEX "SupportMessage_projectId_createdAt_idx" ON "SupportMessage" ("projectId", "createdAt");
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une demande que Lia n'a pas su traiter, transmise au propriétaire.
CREATE TABLE "SupportTicket" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL,
  "projectId"      UUID NOT NULL,
  "conversationId" UUID,
  "endUserId"      UUID,
  -- Fournie par le visiteur s'il veut une réponse. Jamais exigée.
  "email"          TEXT,
  "subject"        TEXT NOT NULL,
  "category"       TEXT NOT NULL DEFAULT 'autre',
  -- low | normal | high
  "priority"       TEXT NOT NULL DEFAULT 'normal',
  -- open | in_progress | resolved | closed
  "status"         TEXT NOT NULL DEFAULT 'open',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "resolvedAt"     TIMESTAMP(3),
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicket_projectId_status_createdAt_idx" ON "SupportTicket" ("projectId", "status", "createdAt");
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket" ("userId", "createdAt");
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_endUserId_fkey"
  FOREIGN KEY ("endUserId") REFERENCES "AppEndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ce que les conversations révèlent, une fois analysées par lot (V2) : question fréquente,
-- fonction demandée, bug possible, question sans réponse. Les exemples sont anonymisés à
-- l'écriture ; l'écran ne montre jamais un message brut.
CREATE TABLE "SupportInsight" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "projectId"  UUID NOT NULL,
  -- frequent_question | feature_request | potential_bug | unanswered
  "kind"       TEXT NOT NULL,
  "title"      TEXT NOT NULL,
  "count"      INTEGER NOT NULL DEFAULT 1,
  "examples"   JSONB NOT NULL DEFAULT '[]',
  -- new | roadmap | dismissed
  "status"     TEXT NOT NULL DEFAULT 'new',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportInsight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportInsight_projectId_status_lastSeenAt_idx" ON "SupportInsight" ("projectId", "status", "lastSeenAt");
CREATE INDEX "SupportInsight_userId_idx" ON "SupportInsight" ("userId");
ALTER TABLE "SupportInsight" ADD CONSTRAINT "SupportInsight_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportInsight" ADD CONSTRAINT "SupportInsight_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════ Notifications ════════════════════════════════

-- Une notification interne, partagée par les deux modules : nouvelle opportunité, question
-- qui revient, ticket ouvert. Une seule table, parce qu'une seule cloche suffit.
CREATE TABLE "Notification" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  -- radar_new | support_ticket | support_insight | support_unanswered
  "kind"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL DEFAULT '',
  "href"      TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification" ("userId", "readAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chacun peut couper les alertes. Deux interrupteurs, un par module.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "radarAlerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportAlerts" BOOLEAN NOT NULL DEFAULT true;

-- ═════════════════════════════ Offres ═════════════════════════════════════

-- Quotas mensuels, réglables depuis le back-office. Valeurs de départ prudentes : une
-- analyse Radar partout — l'exemple donné pour l'offre gratuite — et rien pour Lia tant que
-- l'exploitant n'a pas décidé. Aucune offre n'est modifiée au-delà de ces colonnes.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "radarRunsPerMonth" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "liaAnswersPerMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "liaConversationsPerMonth" INTEGER NOT NULL DEFAULT 0;

-- ═════════════════════════ Cloisonnement ══════════════════════════════════

-- Tables du créateur seul : le Radar et ses retours, les notifications, les enseignements.
ALTER TABLE "RadarRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RadarRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY radarrun_owner ON "RadarRun" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "RadarFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RadarFeedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY radarfeedback_owner ON "RadarFeedback" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- Un signal sans propriétaire est commun ; un signal attribué n'est lisible que par lui.
ALTER TABLE "RadarSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RadarSignal" FORCE ROW LEVEL SECURITY;
CREATE POLICY radarsignal_owner ON "RadarSignal" FOR ALL
  USING ("userId" IS NULL OR "userId" = app_current_user_id())
  WITH CHECK ("userId" IS NULL OR "userId" = app_current_user_id());

ALTER TABLE "SupportInsight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportInsight" FORCE ROW LEVEL SECURITY;
CREATE POLICY supportinsight_owner ON "SupportInsight" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_owner ON "Notification" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- Tables que les visiteurs d'une application atteignent aussi, par la portée d'exécution.
-- Le créateur y a tous les droits sur ses lignes ; le visiteur n'y voit que le projet servi.

ALTER TABLE "SupportSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY supportsettings_owner ON "SupportSettings" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());
CREATE POLICY supportsettings_runtime ON "SupportSettings" FOR SELECT
  USING ("projectId" = app_current_project_id());

ALTER TABLE "SupportKnowledgeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportKnowledgeEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY supportknowledge_owner ON "SupportKnowledgeEntry" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());
-- Le visiteur ne lit que ce qui est publié : un brouillon n'existe pas pour lui.
CREATE POLICY supportknowledge_runtime ON "SupportKnowledgeEntry" FOR SELECT
  USING ("projectId" = app_current_project_id() AND "status" = 'published');

ALTER TABLE "SupportConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportConversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY supportconversation_owner ON "SupportConversation" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());
CREATE POLICY supportconversation_runtime ON "SupportConversation" FOR ALL
  USING ("projectId" = app_current_project_id())
  WITH CHECK ("projectId" = app_current_project_id());

ALTER TABLE "SupportMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportMessage" FORCE ROW LEVEL SECURITY;
-- Le message n'a pas de colonne propriétaire : il suit sa conversation.
CREATE POLICY supportmessage_owner ON "SupportMessage" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "SupportConversation" c
    WHERE c."id" = "SupportMessage"."conversationId" AND c."userId" = app_current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "SupportConversation" c
    WHERE c."id" = "SupportMessage"."conversationId" AND c."userId" = app_current_user_id()
  ));
CREATE POLICY supportmessage_runtime ON "SupportMessage" FOR ALL
  USING ("projectId" = app_current_project_id())
  WITH CHECK ("projectId" = app_current_project_id());

ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicket" FORCE ROW LEVEL SECURITY;
CREATE POLICY supportticket_owner ON "SupportTicket" FOR ALL
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());
-- Le visiteur peut ouvrir un ticket, jamais en lire un.
CREATE POLICY supportticket_runtime_insert ON "SupportTicket" FOR INSERT
  WITH CHECK ("projectId" = app_current_project_id());

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'RadarRun', 'RadarFeedback', 'RadarSignal',
    'SupportSettings', 'SupportKnowledgeEntry', 'SupportConversation', 'SupportMessage',
    'SupportTicket', 'SupportInsight', 'Notification'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appforge_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evoliia_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO evoliia_app', t);
    END IF;
  END LOOP;
END
$$;
