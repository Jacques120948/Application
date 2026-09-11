# 6. Risques

## 6.1 Risques techniques

| # | Risque | Gravité | Traitement retenu |
|---|---|---|---|
| T1 | **Le vocabulaire de l'AppSpec est trop pauvre** : l'IA ne sait pas exprimer ce que l'utilisateur demande | Élevée | Le schéma est versionné et extensible. L'IA signale explicitement une demande hors vocabulaire (`unsupported`) au lieu d'inventer. Ces refus sont journalisés : ils forment la liste de priorités des blocs à ajouter |
| T2 | **Dérive du schéma** : une AppSpec v1 en base devient illisible par le code v2 | Élevée | `specVersion` obligatoire + migrations de spécification pures et testées, appliquées à la lecture. Aucune version ancienne n'est réécrite en base |
| T3 | **Coût IA supérieur au revenu** | Élevée | Crédits vérifiés avant appel, coût réel mesuré par appel, tableau de marge dans l'administration, routage vers un modèle moins cher pour les opérations fréquentes |
| T4 | **Latence de génération** (une génération complète prend des dizaines de secondes) | Moyenne | Diffusion en flux de la réponse, état de progression explicite, opération idempotente reprenable |
| T5 | **Volume de données des applications générées** | Moyenne | Table unique indexée, quotas par plan, pagination obligatoire côté API |
| T6 | **Verrouillage de la plateforme** (exigence 29) | Moyenne | Le compilateur vers projet exportable est prévu dès l'architecture ; l'AppSpec est un JSON documenté, pas un format opaque |
| T7 | **Règles des stores mobiles changeantes** | Moyenne | Aucune promesse d'acceptation. La couche de paiement distingue dès maintenant web / iOS / Android, ce qui évite une réécriture quand les règles bougent |

## 6.2 Risques de sécurité

| # | Risque | Traitement |
|---|---|---|
| S1 | **Fuite entre locataires** (exigence 18) | Quatre barrières indépendantes, voir document 4. RLS PostgreSQL comme filet indépendant du code |
| S2 | **Injection de prompt** conduisant à une action privilégiée | L'IA n'a aucun outil privilégié. Sa seule sortie possible est une donnée validée |
| S3 | **XSS via le contenu généré** | Aucune insertion HTML brute. Toutes les chaînes de l'AppSpec sont rendues comme du texte. Liens filtrés par liste blanche de protocoles. En-tête `Content-Security-Policy` strict sur les applications publiées |
| S4 | **Exposition de secrets côté client** | Seules les variables `NEXT_PUBLIC_*` traversent. Secrets des créateurs chiffrés en base (AES-256-GCM), jamais renvoyés par une API, jamais exportés |
| S5 | **Vol de session** | Cookie `HttpOnly`, `Secure`, `SameSite=Lax` ; jeton stocké haché ; expiration et révocation ; sessions studio et sessions d'applications générées totalement disjointes |
| S6 | **Attaque par force brute sur les mots de passe** | scrypt paramétré, limitation de débit par adresse IP et par compte, réponses de connexion indifférenciées |
| S7 | **Épuisement de ressources** (boucle IA, envoi massif) | Limitation de débit à plusieurs niveaux, quotas de crédits, taille des requêtes bornée |
| S8 | **Injection SQL** | Prisma paramétré ; les rares requêtes brutes utilisent exclusivement des paramètres liés |
| S9 | **CSRF** | Cookies `SameSite=Lax` + vérification d'origine sur toute requête mutante |
| S10 | **Données personnelles des utilisateurs finaux** | Le créateur est responsable de traitement ; la plateforme fournit la politique de confidentialité générée à partir du fonctionnement réel de l'application, et la suppression en cascade d'un projet |

## 6.3 Risques produit

| # | Risque | Traitement |
|---|---|---|
| P1 | **Déception** : l'utilisateur attend Uber, obtient une application de contenu | Le blueprint annonce clairement ce qui sera construit **avant** de consommer des crédits, et dit ce qui n'est pas réalisable |
| P2 | **Promesses de revenus** (exigence 22) | Vocabulaire contraint dans les prompts et dans l'interface : « potentiel de monétisation », jamais de montant promis |
| P3 | **Attente irréaliste sur les stores** | Distinction stricte et visible entre « Prêt pour soumission » et « Approuvé par Apple » |
