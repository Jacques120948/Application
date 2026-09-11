# 7. Arborescence du projet

```
Application/
├── docs/                          Architecture, décisions, exploitation
├── prisma/
│   ├── schema.prisma              Modèle de données
│   ├── migrations/                Migrations versionnées (dont RLS)
│   └── seed.ts                    Plans par défaut, compte de démonstration
├── public/
├── src/
│   ├── app/                       Next.js App Router
│   │   ├── [locale]/              Studio, localisé (fr, en, de, it, es)
│   │   │   ├── (marketing)/       Page d'accueil publique
│   │   │   ├── (auth)/            Inscription, connexion
│   │   │   ├── dashboard/         Mes applications
│   │   │   ├── projects/[id]/     Aperçu, IA, design, monétisation, tests, publication
│   │   │   └── admin/             Back-office
│   │   ├── a/[slug]/              Runtime public des applications créées
│   │   ├── preview/[projectId]/   Aperçu de travail (iframe, propriétaire seul)
│   │   └── api/                   Routes HTTP (fines, sans logique métier)
│   │       ├── auth/              inscription, connexion, déconnexion
│   │       ├── projects/          CRUD, versions, publication
│   │       ├── ai/                blueprint, generate, edit, ideas
│   │       └── app/[projectId]/   API des applications générées (données, comptes)
│   ├── components/
│   │   ├── ui/                    Design system (Button, Card, Field, Dialog…)
│   │   ├── studio/                Chat, aperçu appareil, panneau de réglages
│   │   └── runtime/               Rendu des blocs d'AppSpec
│   ├── server/
│   │   ├── ai/                    Client Anthropic, prompts, routage, comptabilité
│   │   ├── auth/                  Sessions, mots de passe, gardes
│   │   ├── billing/               Plans, crédits, fournisseurs de paiement
│   │   ├── db/                    Client Prisma, portée de locataire
│   │   ├── observability/         Journalisation structurée
│   │   ├── projects/              Cas d'usage projet
│   │   ├── runtime/               Données des applications générées
│   │   └── spec/                  Schéma AppSpec, patch, compilateurs, contrôles
│   ├── i18n/                      Catalogues de traduction et résolution
│   └── lib/                       Utilitaires purs (ids, erreurs, validation)
├── tests/
│   ├── unit/                      Schéma, patch, crédits, sécurité des chemins
│   └── integration/               Authentification, projets, isolation (base réelle)
└── scripts/                       Outils d'exploitation
```

Règles de dépendance, vérifiées en revue :

- `src/app/**` peut importer `src/server/**` (côté serveur uniquement) et `src/components/**`.
- `src/server/**` n'importe jamais `src/app/**`.
- `src/components/**` n'importe jamais `src/server/**` ; il reçoit des données par props.
- `prisma` n'est importé que dans `src/server/db/**` et les fichiers `repository.ts`.
