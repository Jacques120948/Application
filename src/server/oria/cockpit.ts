import { MEMBRES } from '@/lib/equipe'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import { lireActivite, type Evenement } from './activite'
import { faiblessePrincipale, type Canal } from './sante'
import { lireSignaux, type Consolidation, type Signal } from './signaux'

/**
 * Ce que le cockpit d'Oria montre, assemblé en un passage.
 *
 * Tout ce qui est ici est de la lecture : aucun appel à un modèle, donc aucun crédit. C'est
 * la règle de la maison — ce qui se compte ne se paie pas — et c'est aussi ce qui permet
 * d'ouvrir le cockpit dix fois par jour sans y penser. La phrase du jour elle-même est
 * assemblée par du code, à partir des états de canaux : elle dit moins bien qu'un modèle,
 * et elle ne peut rien inventer.
 */

/** Trois, et pas un de plus : au-delà, une priorité redevient une liste. */
export const PRIORITES_MAX = 3

export const STATUTS_AGENT = ['actif', 'action', 'connexion', 'a-lancer'] as const

export type StatutAgent = (typeof STATUTS_AGENT)[number]

export type EtatAgent = {
  id: VisibilityAgentId
  /** Ce qu'il fait en ce moment, en un mot. */
  statut: StatutAgent
  /** Sa dernière lecture réelle. `null` : jamais, et l'écran l'écrit. */
  derniere: Date | null
  /** Combien des points ouverts viennent de lui. */
  ouverts: number
  /** Dont critiques. C'est ce qui fait passer son statut à « action requise ». */
  critiques: number
}

/**
 * L'état de chaque membre de l'équipe.
 *
 * Quatre statuts seulement, et chacun se déduit d'un fait :
 * - « connexion nécessaire » : le compte que l'agent suit n'est pas relié ;
 * - « analyse à lancer » : l'agent travaille sur le site, et le site n'a jamais été
 *   analysé jusqu'au bout ;
 * - « action requise » : un de ses constats est critique ;
 * - « actif » : le reste.
 *
 * Il n'y a pas de statut « en analyse » ni « erreur » : rien n'enregistre aujourd'hui
 * qu'un agent est en train de travailler, ni qu'il a échoué. Un statut qu'on ne sait pas
 * calculer ne s'affiche pas — on ne l'invente pas pour que la grille soit complète.
 */
export function etatsEquipe(vue: Pick<Consolidation, 'signaux' | 'sourcesLues' | 'site' | 'reperes'>): EtatAgent[] {
  const siteAgents: readonly VisibilityAgentId[] = ['audit', 'seo', 'geo', 'content', 'cro']

  return MEMBRES.filter((membre) => membre.id !== 'oria').map((membre) => {
    const id = membre.id as VisibilityAgentId
    const siens = vue.signaux.filter((signal) => signal.sources.includes(id))
    const critiques = siens.filter((signal) => signal.urgence === 'critique').length

    const derniere =
      id === 'ads' ? vue.reperes.ads : id === 'meta' ? vue.reperes.meta : vue.reperes.audit

    let statut: StatutAgent
    if ((id === 'ads' || id === 'meta') && !vue.sourcesLues.includes(id)) statut = 'connexion'
    else if (siteAgents.includes(id) && vue.site === null) statut = 'a-lancer'
    else if (critiques > 0) statut = 'action'
    else statut = 'actif'

    return { id, statut, derniere, ouverts: siens.length, critiques }
  })
}

/** Une liste de noms écrite comme on la dit : « A, B et C ». */
function enumerer(noms: readonly string[]): string {
  if (noms.length <= 1) return noms[0] ?? ''
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
}

/**
 * La phrase du jour : ce qui tient, ce qui cède, ce qu'Oria ne voit pas.
 *
 * Deux phrases au plus, assemblées par du code. Chacune repose sur un état de canal, qui
 * repose lui-même sur un chiffre : rien n'y est estimé. La troisième règle compte autant
 * que les deux autres — un canal inconnu est nommé comme tel, jamais rangé parmi ceux qui
 * vont bien. Dire « tout va bien » à quelqu'un dont on ne regarde pas la publicité serait
 * le rassurer sur ce qu'on ignore.
 */
export function phraseDuJour(canaux: readonly Canal[]): string {
  const bons = canaux.filter((canal) => canal.etat === 'bon').map((canal) => canal.nom)
  const inconnus = canaux.filter((canal) => canal.etat === 'inconnu').map((canal) => canal.nom)
  const faiblesse = faiblessePrincipale(canaux)

  const phrases: string[] = []
  if (faiblesse === null) {
    phrases.push(
      bons.length === 0
        ? 'Je n’ai encore rien de mesuré sur lequel m’appuyer.'
        : `Rien ne cède sur ce que je vois : ${enumerer(bons)} ${bons.length > 1 ? 'tiennent' : 'tient'}.`,
    )
  } else {
    const verbe = faiblesse.etat === 'renforcer' ? 'est à renforcer' : 'est à surveiller'
    phrases.push(
      bons.length === 0
        ? `Votre point faible du moment : ${faiblesse.nom}, qui ${verbe} (${faiblesse.pourquoi.replace(/\.$/u, '')}).`
        : `${enumerer(bons)} ${bons.length > 1 ? 'tiennent' : 'tient'} ; votre point faible du moment est ${faiblesse.nom}, qui ${verbe} (${faiblesse.pourquoi.replace(/\.$/u, '')}).`,
    )
  }
  if (inconnus.length > 0) {
    phrases.push(`Je ne vois pas encore ${enumerer(inconnus)}.`)
  }
  return phrases.join(' ')
}

export type Cockpit = Consolidation & {
  /** Les trois premières, dans l'ordre du calcul. */
  priorites: Signal[]
  /** Le reste, pour « voir les autres recommandations ». */
  autres: Signal[]
  /**
   * Les points critiques qui ne figurent pas déjà parmi les trois priorités.
   *
   * Une alerte qui répète une priorité affichée juste au-dessus est du bruit, et le bruit
   * est précisément ce qu'Oria est censée retirer.
   */
  alertes: Signal[]
  equipe: EtatAgent[]
  activite: Evenement[]
  phrase: string
}

/** Tout le cockpit, en un passage. */
export async function lireCockpit(
  userId: string,
  locale: string,
  siteId?: string,
): Promise<Cockpit> {
  const vue = await lireSignaux(userId, locale, siteId)
  const activite = await lireActivite(userId, vue.site?.id ?? null).catch(() => [])

  const priorites = vue.signaux.slice(0, PRIORITES_MAX)
  const autres = vue.signaux.slice(PRIORITES_MAX)

  return {
    ...vue,
    priorites,
    autres,
    alertes: autres.filter((signal) => signal.urgence === 'critique'),
    equipe: etatsEquipe(vue),
    activite,
    phrase: phraseDuJour(vue.canaux),
  }
}
