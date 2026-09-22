-- Images créées pour illustrer un article, quand la boutique n'a rien qui corresponde.
--
-- Le rapprochement avec les fiches réelles reste la première voie, et de loin la meilleure :
-- une vraie photo du produit vaut mieux que n'importe quelle image inventée, et elle mène à
-- une fiche. Ces images-ci sont le filet pour les sections qu'aucune fiche ne sait montrer —
-- « un atelier », « une flamme de près » — et pour lesquelles la seule autre option était de
-- rester vide.
--
-- Stockées en base, comme les images des applications l'étaient : pas d'hébergeur de plus,
-- pas de secret de plus, pas de facture de plus. Le volume est borné en amont par le quota
-- mensuel de l'offre, qui est à zéro partout par défaut.
--
-- Ce que cette table ne contient PAS est aussi important que ce qu'elle contient : ni la
-- demande envoyée au modèle, ni le sujet de l'article, ni rien qui décrive le travail en
-- cours. Seulement l'image et son texte de remplacement — c'est-à-dire exactement ce qui
-- partira sur le blog public du client. C'est ce qui permet à la lecture d'être publique
-- sans rien concéder (voir le cloisonnement, plus bas).

CREATE TABLE "SiteImage" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId"    UUID NOT NULL,
  "userId"    UUID NOT NULL,
  -- Toujours image/webp : c'est ce que le ré-encodage produit, quoi que le fournisseur rende.
  "mime"      TEXT NOT NULL,
  "width"     INTEGER NOT NULL,
  "height"    INTEGER NOT NULL,
  "bytes"     INTEGER NOT NULL,
  "data"      BYTEA NOT NULL,
  -- Le texte de remplacement, qui part tel quel dans le blog. Une image sans alternative
  -- textuelle est précisément un des défauts que l'analyse reproche : il serait absurde
  -- d'en créer en illustrant.
  "alt"       TEXT NOT NULL DEFAULT '',
  -- Crédits réellement débités pour cette image, au coût constaté.
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteImage_pkey" PRIMARY KEY ("id")
);

-- Le compte du mois se fait sur ces deux colonnes : c'est lui qui applique le quota.
CREATE INDEX "SiteImage_userId_createdAt_idx" ON "SiteImage" ("userId", "createdAt");
CREATE INDEX "SiteImage_siteId_idx" ON "SiteImage" ("siteId");

ALTER TABLE "SiteImage"
  ADD CONSTRAINT "SiteImage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteImage"
  ADD CONSTRAINT "SiteImage_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Cloisonnement ────────────────────────────────
--
-- Écriture et suppression réservées au propriétaire, comme partout. `FORCE` est
-- indispensable : sans lui, le propriétaire des tables contournerait ses propres règles, et
-- c'est précisément lui qui exécute les migrations.
ALTER TABLE "SiteImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteImage" FORCE ROW LEVEL SECURITY;
CREATE POLICY siteimage_owner ON "SiteImage" FOR ALL
  USING ("userId" = app_current_user_id())
  WITH CHECK ("userId" = app_current_user_id());

/*
 * La lecture, elle, est publique, et c'est une exception assumée — la seule de ce genre
 * avec celle des applications publiées.
 *
 * La raison : ces images sont faites pour être servies au visiteur d'un blog, qui n'est ni
 * le propriétaire ni même inscrit. Une image que seul son auteur peut charger n'illustre
 * rien. L'adresse est un identifiant aléatoire de cent vingt-huit bits, qui ne s'énumère
 * pas ; c'est la même protection qu'une adresse de CDN, qui est publique elle aussi.
 *
 * Ce qui rend l'exception sans conséquence, c'est la forme de la table : elle ne contient
 * que l'image et son texte de remplacement, c'est-à-dire ce qui sera de toute façon visible
 * sur le blog. Aucune demande envoyée au modèle, aucun sujet d'article, rien du travail en
 * cours. Si l'on devait un jour y ajouter une colonne qui décrit quoi que ce soit, cette
 * politique devrait être revue le même jour.
 */
CREATE POLICY siteimage_public ON "SiteImage" FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteImage" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
