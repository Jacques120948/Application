import { compteActif } from '@/server/ads/comptes'
import { withUserScope } from '@/server/db/scope'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import type { Signal } from './signaux'

/**
 * Les ruptures, vues d'en haut.
 *
 * Naya et MIRA ont déjà leurs règles, et elles sont bonnes : une campagne qui dépense sans
 * vendre, un retour qui recule, une audience qui fatigue, un suivi jamais posé. Oria ne les
 * refait pas. Elle regarde ce qu'aucune règle de campagne ne voit, parce que cela se lit
 * sur le compte entier et sur quelques jours : une rupture.
 *
 * - **Une régie qui s'arrête net.** Des jours de dépense, puis plus rien. C'est un moyen de
 *   paiement refusé, un compte suspendu, une campagne coupée par erreur — et cela ne se
 *   voit pas depuis le site, qui continue de s'afficher.
 * - **Des conversions qui tombent à zéro pendant que les clics continuent.** Les visiteurs
 *   arrivent, rien n'est plus compté : c'est presque toujours le suivi qui a cassé, pas
 *   les ventes qui ont disparu. Les règles de Naya ne le voient que lorsque la fenêtre
 *   entière est à zéro ; Oria le voit dès le troisième jour.
 * - **Un coût par clic qui s'envole** sur tout le compte, d'une semaine sur les trois
 *   précédentes.
 * - **Le trafic depuis Google qui chute**, que personne ne surveillait : Néo travaille les
 *   pages, il ne regarde pas la courbe.
 *
 * Chaque détecteur exige un volume minimal. Une rupture sur trois clics n'est pas une
 * rupture, et une alerte qui crie pour rien apprend à ne plus lire les alertes.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

/** Jours de lecture : de quoi comparer une semaine aux trois précédentes. */
const JOURS = 29

export const SEUILS = {
  /** Dépense quotidienne moyenne en deçà de laquelle un arrêt n'est pas une nouvelle. */
  depenseArret: 5,
  /** Jours sans dépense pour parler d'arrêt. Un seul jour peut être une remontée tardive. */
  joursArret: 2,
  /** Conversions quotidiennes moyennes avant la rupture, pour qu'une absence soit parlante. */
  conversionsRupture: 1,
  joursRupture: 3,
  /** Les clics doivent continuer au moins à cette part de leur niveau : sinon, c'est un arrêt. */
  clicsMaintenus: 0.5,
  /** Hausse du coût par clic considérée comme une envolée. */
  hausseCpc: 0.4,
  /** Clics minimaux de chaque côté pour comparer un coût par clic. */
  clicsCpc: 100,
  /** Chute du trafic Google considérée comme notable. */
  chuteTrafic: 0.4,
  /** Clics hebdomadaires de référence en deçà desquels une chute n'apprend rien. */
  clicsTrafic: 50,
} as const

export type Jour = { jour: Date; cout: number; clics: number; conversions: number }

function somme(jours: readonly Jour[], champ: 'cout' | 'clics' | 'conversions'): number {
  return jours.reduce((total, jour) => total + jour[champ], 0)
}

/** Les jours d'une série, du plus ancien au plus récent, complétés de zéros. */
export function completer(lignes: readonly Jour[], jusqua: Date, jours = JOURS): Jour[] {
  const fin = Date.UTC(jusqua.getUTCFullYear(), jusqua.getUTCMonth(), jusqua.getUTCDate())
  const parJour = new Map(lignes.map((ligne) => [ligne.jour.toISOString().slice(0, 10), ligne]))
  const serie: Jour[] = []
  for (let rang = jours; rang >= 1; rang -= 1) {
    const jour = new Date(fin - rang * JOUR_MS)
    serie.push(parJour.get(jour.toISOString().slice(0, 10)) ?? { jour, cout: 0, clics: 0, conversions: 0 })
  }
  return serie
}

type Detection = Omit<Signal, 'href' | 'sources'>

/**
 * Une régie qui s'arrête net : les derniers jours à zéro, après une dépense régulière.
 *
 * `serie` va jusqu'à hier : le jour en cours n'est jamais complet, et le compter ferait
 * annoncer un arrêt chaque matin.
 */
export function arret(serie: readonly Jour[], nom: string, devise: string): Detection | null {
  const recents = serie.slice(-SEUILS.joursArret)
  const avant = serie.slice(-SEUILS.joursArret - 7, -SEUILS.joursArret)
  if (avant.length < 7) return null
  const moyenne = somme(avant, 'cout') / avant.length
  if (moyenne < SEUILS.depenseArret) return null
  if (somme(recents, 'cout') > 0) return null
  return {
    cle: `anomalie:arret:${nom}`,
    titre: `${nom} ne dépense plus rien depuis ${SEUILS.joursArret} jours`,
    pourquoi: `Le compte dépensait en moyenne ${Math.round(moyenne)} ${devise} par jour, puis plus rien. C’est souvent un moyen de paiement refusé, un compte suspendu ou une campagne coupée par erreur — et cela ne se voit pas depuis le site.`,
    quoiFaire: `Ouvrez le gestionnaire de ${nom} : un bandeau y dit presque toujours pourquoi.`,
    mesure: `Relevés quotidiens des 9 derniers jours, jusqu’à hier.`,
    impact: 'eleve',
    effort: 'faible',
    urgence: 'critique',
    confiance: 'elevee',
  }
}

/** Des conversions qui tombent à zéro pendant que les clics continuent : le suivi a cassé. */
export function rupture(serie: readonly Jour[], nom: string): Detection | null {
  const recents = serie.slice(-SEUILS.joursRupture)
  const avant = serie.slice(-SEUILS.joursRupture - 14, -SEUILS.joursRupture)
  if (avant.length < 14) return null
  const conversionsAvant = somme(avant, 'conversions') / avant.length
  if (conversionsAvant < SEUILS.conversionsRupture) return null
  if (somme(recents, 'conversions') > 0) return null
  const clicsAvant = somme(avant, 'clics') / avant.length
  const clicsRecents = somme(recents, 'clics') / recents.length
  if (clicsAvant <= 0 || clicsRecents < clicsAvant * SEUILS.clicsMaintenus) return null
  return {
    cle: `anomalie:rupture:${nom}`,
    titre: `Plus aucune conversion comptée chez ${nom} depuis ${SEUILS.joursRupture} jours`,
    pourquoi: `Les clics continuent (${Math.round(clicsRecents)} par jour), mais aucune conversion n’est enregistrée, contre ${conversionsAvant.toFixed(1).replace('.', ',')} par jour avant. Quand les visiteurs arrivent et que plus rien n’est compté, c’est presque toujours le suivi qui a cassé — une mise à jour du site, une balise retirée — pas les ventes qui ont disparu.`,
    quoiFaire: 'Vérifiez qu’une commande de test est bien comptée. Tant que le suivi ne remonte rien, les règles de rentabilité travaillent à l’aveugle.',
    mesure: `Relevés quotidiens des ${SEUILS.joursRupture + 14} derniers jours, jusqu’à hier.`,
    impact: 'eleve',
    effort: 'moyen',
    urgence: 'critique',
    confiance: 'elevee',
  }
}

/** Un coût par clic qui s'envole : la dernière semaine contre les trois précédentes. */
export function envoleeCpc(serie: readonly Jour[], nom: string, devise: string): Detection | null {
  const semaine = serie.slice(-7)
  const avant = serie.slice(-28, -7)
  const clicsSemaine = somme(semaine, 'clics')
  const clicsAvant = somme(avant, 'clics')
  if (clicsSemaine < SEUILS.clicsCpc || clicsAvant < SEUILS.clicsCpc) return null
  const cpc = somme(semaine, 'cout') / clicsSemaine
  const cpcAvant = somme(avant, 'cout') / clicsAvant
  if (cpcAvant <= 0 || cpc / cpcAvant - 1 < SEUILS.hausseCpc) return null
  const format = (valeur: number) => valeur.toFixed(2).replace('.', ',')
  return {
    cle: `anomalie:cpc:${nom}`,
    titre: `Le coût par clic s’envole chez ${nom}`,
    pourquoi: `${format(cpc)} ${devise} par clic cette semaine, contre ${format(cpcAvant)} ${devise} les trois précédentes (+${Math.round((cpc / cpcAvant - 1) * 100)} %). À budget égal, cela fait autant de visiteurs en moins.`,
    quoiFaire: `Demandez à ${nom === 'Google Ads' ? 'Naya' : 'MIRA'} ce qui a changé : concurrence, ciblage, ou annonces moins pertinentes.`,
    mesure: `${clicsSemaine} clics cette semaine, ${clicsAvant} sur les trois précédentes.`,
    impact: 'moyen',
    effort: 'moyen',
    urgence: 'important',
    confiance: 'elevee',
  }
}

/** Le trafic depuis Google qui chute : la dernière semaine contre la moyenne des trois d'avant. */
export function chuteTrafic(clicsParJour: readonly { jour: Date; clics: number }[], jusqua: Date): Detection | null {
  const serie = completer(
    clicsParJour.map((un) => ({ jour: un.jour, cout: 0, clics: un.clics, conversions: 0 })),
    jusqua,
  )
  // Des jours sans relevé ne sont pas des jours sans clic : on se tait s'il en manque.
  const releves = new Set(clicsParJour.map((un) => un.jour.toISOString().slice(0, 10)))
  if (serie.slice(-28).some((jour) => !releves.has(jour.jour.toISOString().slice(0, 10)))) return null

  const semaine = somme(serie.slice(-7), 'clics')
  const reference = somme(serie.slice(-28, -7), 'clics') / 3
  if (reference < SEUILS.clicsTrafic) return null
  const chute = 1 - semaine / reference
  if (chute < SEUILS.chuteTrafic) return null
  return {
    cle: 'anomalie:trafic-google',
    titre: 'Le trafic depuis Google a chuté cette semaine',
    pourquoi: `${semaine} clics depuis Google cette semaine, contre ${Math.round(reference)} en moyenne les trois précédentes (−${Math.round(chute * 100)} %). Une chute de cet ordre vient souvent d’une page désindexée, d’un changement sur le site ou d’une mise à jour de Google.`,
    quoiFaire: 'Demandez à Néo de regarder quelles recherches ont perdu des clics, et à Léa si une page a cessé de répondre.',
    mesure: 'Relevés quotidiens de Google Search Console, quatre semaines complètes.',
    impact: 'eleve',
    effort: 'moyen',
    urgence: 'important',
    confiance: 'elevee',
  }
}

async function sans<T>(lecture: Promise<T>, defaut: T): Promise<T> {
  return lecture.catch(() => defaut)
}

/**
 * Les anomalies du moment, prêtes à entrer dans le classement d'Oria.
 *
 * Tout se lit dans ce qui est déjà en base : relevés publicitaires, relevés de recherche.
 * Aucun appel aux plateformes, aucun modèle, aucun crédit.
 */
export async function lireAnomalies(
  userId: string,
  locale: string,
  siteId: string | null,
  maintenant = new Date(),
): Promise<Signal[]> {
  const aujourdhui = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()))
  const depuis = new Date(+aujourdhui - JOURS * JOUR_MS)
  const signaux: Signal[] = []

  for (const [plateforme, nom, agent, href] of [
    ['google-ads', 'Google Ads', 'ads', `/${locale}/publicite`],
    ['meta-ads', 'Meta Ads', 'meta', `/${locale}/publicite/meta`],
  ] as const) {
    const compte = await sans(compteActif(userId, plateforme), null)
    if (compte === null) continue
    const lignes = await sans(
      withUserScope(userId, (tx) =>
        tx.adsReleve.findMany({
          where: { userId, accountId: compte.id, groupeId: '', annonceId: '', jour: { gte: depuis, lt: aujourdhui } },
          select: { jour: true, coutMicros: true, clics: true, conversions: true },
        }),
      ),
      [],
    )
    // Plusieurs campagnes par jour : on additionne, c'est le compte qu'on regarde.
    const parJour = new Map<string, Jour>()
    for (const ligne of lignes) {
      const cle = ligne.jour.toISOString().slice(0, 10)
      const deja = parJour.get(cle) ?? { jour: ligne.jour, cout: 0, clics: 0, conversions: 0 }
      parJour.set(cle, {
        jour: ligne.jour,
        cout: deja.cout + Number(ligne.coutMicros) / 1_000_000,
        clics: deja.clics + Number(ligne.clics),
        conversions: deja.conversions + ligne.conversions,
      })
    }
    const serie = completer([...parJour.values()], aujourdhui)
    const sources: VisibilityAgentId[] = [agent]
    for (const detection of [arret(serie, nom, compte.devise), rupture(serie, nom), envoleeCpc(serie, nom, compte.devise)]) {
      if (detection !== null) signaux.push({ ...detection, sources, href })
    }
  }

  if (siteId !== null) {
    const releves = await sans(
      withUserScope(userId, (tx) =>
        tx.releveRecherche.findMany({
          where: { userId, siteId, jour: { gte: depuis, lt: aujourdhui } },
          select: { jour: true, clics: true },
        }),
      ),
      [],
    )
    const chute = chuteTrafic(releves, aujourdhui)
    if (chute !== null) {
      signaux.push({ ...chute, sources: ['seo'], href: `/${locale}/visibilite/recherches?siteId=${siteId}` })
    }
  }

  return signaux
}
