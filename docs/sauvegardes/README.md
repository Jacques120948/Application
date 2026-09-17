# Sauvegardes d'offres retirées

Une offre supprimée de la table `Plan` l'est définitivement : rien ne la conserve, et son
identifiant peut être réutilisé par erreur des mois plus tard. Ce dossier garde donc l'état
exact des lignes retirées, à la date de leur retrait, pour qu'un retour en arrière soit une
insertion et non une reconstitution de mémoire.

Chaque fichier est nommé `offres-retirees-AAAA-MM-JJ.json` et contient les lignes telles
qu'elles étaient. Aucun secret n'y figure : les identifiants Stripe sont des références
publiques de catalogue, pas des clés.

## Remettre une offre

```bash
npx tsx scripts/restaurer-offres.ts docs/sauvegardes/offres-retirees-2026-09-17.json
```

Le script n'écrase jamais une offre existante : une offre en base appartient à l'exploitant,
et une restauration ne doit pas défaire un réglage fait depuis.
