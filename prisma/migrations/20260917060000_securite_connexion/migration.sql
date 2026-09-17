-- Sécurité de la connexion : inactivité et tentatives.
--
-- Deux ajouts, deux raisons distinctes.
--
-- `lastSeenAt` rend possible la déconnexion pour inactivité. Sans lui, la seule échéance
-- d'une session était son expiration lointaine : une session ouverte sur un poste partagé
-- et oubliée le restait des semaines.
--
-- `AuthThrottle` compte les tentatives ratées là où elles survivent. Le compteur en mémoire
-- du processus ne suffit pas : sur un hébergement sans état, chaque requête peut tomber sur
-- une instance neuve dont le compteur est vide, et une limite qui ne tient que dans une
-- mémoire volatile n'est pas une limite.
--
-- Cette table ne porte aucune valeur en clair : ni adresse visée, ni adresse IP, seulement
-- leur empreinte. Une copie ne dit pas qui a essayé de se connecter, ni d'où.
--
-- Elle n'est pas soumise au cloisonnement, et c'est nécessaire : elle est écrite avant toute
-- authentification, quand il n'existe précisément aucune identité à laquelle se rattacher.
-- Aucun écran ne la relit ; seul le serveur la consulte, pour décider de refuser.

ALTER TABLE "Session" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AuthThrottle" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope"        TEXT NOT NULL,
  "keyHash"      TEXT NOT NULL,
  "failures"     INTEGER NOT NULL DEFAULT 0,
  "windowStart"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthThrottle_scope_keyHash_key" ON "AuthThrottle" ("scope", "keyHash");
CREATE INDEX "AuthThrottle_blockedUntil_idx" ON "AuthThrottle" ("blockedUntil");

-- L'octroi est conditionnel : le rôle n'existe que sur une installation montée avec
-- scripts/setup-db.sql, et une migration qui échoue bloque toutes les suivantes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appforge_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AuthThrottle" TO appforge_app;
  ELSE
    RAISE NOTICE 'Role appforge_app absent : octrois ignores. Voir scripts/setup-db.sql.';
  END IF;
END $$;
