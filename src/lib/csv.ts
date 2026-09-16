/**
 * Écriture de fichiers CSV.
 *
 * Le guillemet doublé et l'encadrement systématique évitent le piège classique : une
 * réponse contenant une virgule ou un retour à la ligne décalerait toutes les colonnes
 * suivantes, sans que rien ne signale l'erreur.
 *
 * Vit ici parce que deux endroits en ont besoin : l'export complet d'un projet et l'export
 * des seules données d'un modèle. Deux versions de cette règle finiraient par produire deux
 * fichiers dont l'un s'ouvre et l'autre non.
 */

export function csvCell(value: unknown): string {
  const texte =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  return `"${texte.replace(/"/g, '""')}"`
}

/** Une ligne de CSV, cellules déjà échappées. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',')
}
