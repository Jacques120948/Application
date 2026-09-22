-- Ce que MIRA a fait chez Meta, vu de l'exploitant — et rien de plus.
--
-- Il fallait pouvoir surveiller la seule fonction du produit qui engage la dépense de
-- quelqu'un d'autre : si MIRA se trompait à l'échelle, l'exploitant doit le voir avant que
-- ses clients ne l'appellent. Or cette vue est impossible à bâtir sur les tables du journal :
-- « AdsAction » et « AdsAccount » portent FORCE ROW LEVEL SECURITY avec une politique de
-- propriétaire, sans exception pour l'administrateur — qui est un utilisateur comme un
-- autre. Un comptage fait depuis le back-office y rend zéro, en silence.
--
-- Deux issues existaient. Percer le cloisonnement pour l'administration, c'est-à-dire
-- rouvrir la porte que tout le reste du produit ferme : n'importe quel code qui poserait la
-- variable de session lirait alors tout. Ou compter ailleurs ce qui n'a pas besoin
-- d'appartenir à quelqu'un. C'est la seconde qui est prise ici.
--
-- Cette table ne contient donc AUCUNE donnée de client : ni identifiant de personne, ni
-- compte publicitaire, ni campagne, ni montant. Le geste, son issue, et ce que Meta a
-- répondu quand il a refusé. C'est exactement ce qu'il faut pour répondre à « MIRA
-- fonctionne-t-elle » et rien de ce qu'il faudrait pour répondre à « que fait ce client »,
-- ce qui est le partage voulu.
--
-- Elle n'est pas dans la liste des tables cloisonnées de scripts/verify-isolation.ts, et
-- c'est délibéré : une table sans propriétaire n'a pas de politique de propriétaire à
-- vérifier. Le jour où l'on y ajouterait une colonne désignant une personne, elle devrait y
-- entrer le même jour — et ce serait le signe qu'on s'est trompé de table.

CREATE TABLE "MetaSupervision" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  -- pause | budget, tel que le journal l'écrit.
  "quoi"      TEXT NOT NULL,
  -- prevu | reussi | refuse. « prevu » signale une écriture coupée en plein vol.
  "resultat"  TEXT NOT NULL,
  -- La réponse de Meta sur un refus, débarrassée de ses identifiants. Voir le code.
  "detail"    TEXT NOT NULL DEFAULT '',
  -- Vrai quand le geste défaisait une modification précédente. Un client qui défait ce que
  -- MIRA a fait n'est pas d'accord avec elle : c'est un signal distinct d'un refus de Meta.
  "retour"    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaSupervision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MetaSupervision_createdAt_idx" ON "MetaSupervision" ("createdAt" DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT ON "MetaSupervision" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
