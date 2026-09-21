/**
 * Les calculs publicitaires, et la raison pour laquelle ils ne sont pas confiés au modèle.
 *
 * Un modèle de langage sait diviser. Il se trompe rarement. « Rarement » suffit pour du
 * texte ; il ne suffit pas pour un chiffre qui décide d'un budget. Une erreur d'arithmétique
 * sur un ROAS ne se voit pas — elle ressemble à un chiffre — et elle se corrige le
 * lendemain, après la dépense. Tout ce que Naya cite est donc calculé ici, et elle ne
 * reçoit que des résultats.
 *
 * Trois règles portent ce module.
 *
 * **Une division par zéro rend `null`, jamais zéro.** Une campagne sans dépense n'a pas un
 * ROAS de 0 % : elle n'en a pas. Afficher zéro ferait croire à un échec là où il n'y a rien
 * à juger, et « zéro » est exactement ce qu'un tableau de bord ne doit pas inventer.
 *
 * **L'argent entre en micros et sort en unités.** La conversion se fait une fois, ici, au
 * moment de produire un chiffre lisible. Partout ailleurs l'argent reste entier.
 *
 * **Une variation ne se calcule pas sur rien.** Comparer une semaine à une période absente
 * rend `null` : c'est une information, et elle se dit. Un « +100 % » sorti d'une division
 * par zéro est un mensonge qui a l'air d'une bonne nouvelle.
 */

/** Ce qu'une période agrège. Des entiers pour l'argent, comme partout. */
export type Cumul = {
  coutMicros: number
  impressions: number
  clics: number
  conversions: number
  valeurConversion: number
}

export const CUMUL_VIDE: Cumul = {
  coutMicros: 0,
  impressions: 0,
  clics: 0,
  conversions: 0,
  valeurConversion: 0,
}

/** Un millionième d'unité monétaire : la convention de Google, adoptée partout. */
export const MICROS = 1_000_000

/** Des micros vers des unités de la devise du compte. La seule conversion du module. */
export function enUnites(micros: number): number {
  return micros / MICROS
}

export function cumuler(journees: readonly Cumul[]): Cumul {
  return journees.reduce<Cumul>(
    (total, jour) => ({
      coutMicros: total.coutMicros + jour.coutMicros,
      impressions: total.impressions + jour.impressions,
      clics: total.clics + jour.clics,
      conversions: total.conversions + jour.conversions,
      valeurConversion: total.valeurConversion + jour.valeurConversion,
    }),
    { ...CUMUL_VIDE },
  )
}

/**
 * Les indicateurs d'une période.
 *
 * Chacun peut valoir `null`, et c'est le point : un indicateur qu'on ne peut pas calculer
 * n'a pas de valeur de repli. L'écran dira « — » et Naya dira qu'elle ne sait pas.
 */
export type Indicateurs = {
  /** Dépense, en unités de la devise du compte. */
  cout: number
  impressions: number
  clics: number
  conversions: number
  /** Valeur des conversions, en unités de la devise. */
  valeur: number
  /** Ce que rapporte chaque unité dépensée, en pourcentage entier. 245 veut dire 245 %. */
  roas: number | null
  /** Ce que coûte une conversion, en unités de la devise. */
  cpa: number | null
  /** Part des affichages qui ont donné un clic, en pourcentage à une décimale. */
  ctr: number | null
  /** Ce que coûte un clic, en unités de la devise. */
  cpc: number | null
  /** Part des clics qui ont donné une conversion, en pourcentage à une décimale. */
  tauxConversion: number | null
}

/** Arrondi à `decimales` chiffres. Rendu en nombre, pour que l'écran décide du format. */
function arrondir(valeur: number, decimales: number): number {
  const facteur = 10 ** decimales
  return Math.round(valeur * facteur) / facteur
}

export function indicateurs(cumul: Cumul): Indicateurs {
  const cout = enUnites(cumul.coutMicros)
  return {
    cout: arrondir(cout, 2),
    impressions: cumul.impressions,
    clics: cumul.clics,
    conversions: arrondir(cumul.conversions, 2),
    valeur: arrondir(cumul.valeurConversion, 2),
    /*
     * Le ROAS n'existe pas sans dépense. Une campagne qui n'a rien dépensé et rien rapporté
     * n'a pas « 0 % de retour » : elle n'a pas de retour à montrer.
     */
    roas: cout === 0 ? null : Math.round((cumul.valeurConversion / cout) * 100),
    cpa: cumul.conversions === 0 ? null : arrondir(cout / cumul.conversions, 2),
    ctr: cumul.impressions === 0 ? null : arrondir((cumul.clics / cumul.impressions) * 100, 1),
    cpc: cumul.clics === 0 ? null : arrondir(cout / cumul.clics, 2),
    tauxConversion:
      cumul.clics === 0 ? null : arrondir((cumul.conversions / cumul.clics) * 100, 1),
  }
}

/**
 * L'écart entre deux périodes de même durée.
 *
 * `null` quand la comparaison n'a pas de sens : pas de période précédente, ou une valeur
 * absente d'un côté. Un tableau de bord qui affiche « +100 % » parce que la période
 * précédente valait zéro dit quelque chose de faux avec l'air de dire quelque chose de bien.
 */
export function variation(actuel: number | null, precedent: number | null): number | null {
  if (actuel === null || precedent === null) return null
  if (precedent === 0) return null
  return arrondir(((actuel - precedent) / Math.abs(precedent)) * 100, 1)
}

/** L'écart en points, pour ce qui est déjà un pourcentage. Un ROAS ne varie pas « de x % ». */
export function ecartEnPoints(actuel: number | null, precedent: number | null): number | null {
  if (actuel === null || precedent === null) return null
  return arrondir(actuel - precedent, 1)
}

/**
 * La journée, en AAAA-MM-JJ, dans le fuseau donné.
 *
 * Le fuseau est celui du compte publicitaire, jamais celui du serveur : une journée de
 * dépense commence là où le compte est déclaré. Un serveur à Francfort qui découpe les
 * journées d'un compte californien décale tout d'un jour, et la variation qu'on en tire
 * compare deux périodes qui ne sont pas celles qu'on croit.
 */
export function jourDansFuseau(date: Date, fuseau: string): string {
  try {
    const parties = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau === '' ? 'UTC' : fuseau,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
    return parties
  } catch {
    // Un fuseau que le système ne connaît pas ne doit pas faire échouer une synchronisation.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }
}

/** Les bornes d'une fenêtre de `jours` journées finissant hier, dans le fuseau du compte. */
export function fenetre(
  jours: number,
  fuseau: string,
  maintenant = new Date(),
): { depuis: string; jusqua: string } {
  /*
   * Elle s'arrête hier, et c'est voulu : la journée en cours est incomplète par définition,
   * et la mettre dans une moyenne fait plonger tous les indicateurs chaque matin.
   */
  const jour = 24 * 60 * 60 * 1000
  const fin = new Date(maintenant.getTime() - jour)
  const debut = new Date(fin.getTime() - (Math.max(1, jours) - 1) * jour)
  return { depuis: jourDansFuseau(debut, fuseau), jusqua: jourDansFuseau(fin, fuseau) }
}
