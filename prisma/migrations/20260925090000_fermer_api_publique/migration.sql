-- Fermer l'API publique de l'hébergeur, et la refermer à chaque déploiement.
--
-- Ce qui s'est passé, parce que ça se reproduira ailleurs. Supabase expose le schéma
-- « public » par une API web, et y donne d'office à ses deux rôles anonymes — anon et
-- authenticated — tous les droits sur toutes les tables. La protection prévue est la RLS,
-- table par table. Nos migrations l'activent sur les tables qui portent des données de
-- locataire ; dix-huit autres n'en ont jamais eu, parce qu'elles n'en avaient pas besoin
-- dans notre modèle : User, Session, VerificationToken, les trois tables de crédits, les
-- réglages, les tarifs.
--
-- Elles se sont donc retrouvées nues derrière une API que personne n'utilise. En lecture,
-- Session suffisait à se connecter à la place de n'importe qui — un jeton de session n'a
-- pas besoin de mot de passe. En écriture, CreditWallet suffisait à s'offrir des crédits.
--
-- Evoliia ne se sert pas de cette API : pas de client Supabase dans le code, l'application
-- parle à Postgres par Prisma avec son propre rôle, qui n'hérite rien de ces deux-là. Le
-- correctif est donc de leur retirer ce qu'ils n'auraient jamais dû avoir, plutôt que
-- d'ajouter de la RLS à des tables qui n'en veulent pas — nos tables n'appartiennent pas
-- au rôle applicatif, et une RLS sans politique couperait l'application net.
--
-- La deuxième moitié est la plus importante et la moins visible : les droits par défaut.
-- Sans elle, la prochaine table créée par une migration repartirait grande ouverte, et
-- personne ne s'en apercevrait avant le prochain courriel de l'hébergeur.
--
-- Le tout est enveloppé dans un test d'existence des rôles : ils n'existent que chez
-- l'hébergeur. En développement et dans les tests, ce fichier ne fait rien.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN

    REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

    -- Les tables sont créées par « postgres » chez l'hébergeur : ce sont ses droits par
    -- défaut qui décident de ce que portera la prochaine.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE ALL ON TABLES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE ALL ON SEQUENCES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    END IF;

  END IF;
END
$$;

-- Figer le chemin de recherche des deux fonctions de portée.
--
-- Elles sont appelées par les soixante-huit politiques d'isolation. Elles ne font que lire
-- un réglage de session et sont en SECURITY INVOKER, donc le risque était faible ; mais une
-- fonction sur laquelle repose toute l'isolation n'a aucune raison de laisser son chemin de
-- résolution au hasard du rôle appelant. pg_catalog suffit : NULLIF, current_setting et la
-- conversion en uuid y sont tous.
ALTER FUNCTION app_current_user_id()    SET search_path = pg_catalog;
ALTER FUNCTION app_current_project_id() SET search_path = pg_catalog;
