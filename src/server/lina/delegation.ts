import { notFound, validation } from '@/lib/errors'
import { askVisibility, type VisibilityNoteView } from '@/server/agents/visibility-service'
import { argent, nombreLisible } from './recommandations'
import { lireLina } from './service'

/**
 * Lina confie une campagne à Milo, ou des paniers perdus à Cleo.
 *
 * Mêmes règles que les transmissions de Nova et d'Oria : rien ne part sans clic, et une
 * transmission est une question posée à un spécialiste, qui coûte ce qu'une question coûte.
 * Le navigateur ne désigne qu'une campagne ; la question est écrite ici, avec les seuls
 * totaux du segment. **Aucune donnée client n'y figure** : Milo écrit pour « 184 clients
 * inactifs depuis six mois, panier moyen CHF 78 », pas pour des personnes.
 */

const QUESTION_MAX = 1_200

function couper(texte: string, longueur: number): string {
  const propre = texte.replace(/\s+/gu, ' ').trim()
  return propre.length <= longueur ? propre : `${propre.slice(0, longueur - 1).trimEnd()}…`
}

export async function deleguerLina(
  userId: string,
  entree: { siteId?: string; cle: string; agent: 'content' | 'cro' },
  locale: string,
): Promise<VisibilityNoteView> {
  if (entree.siteId === undefined) throw validation('Lina ne transmet que sur un site analysé : lancez d’abord une analyse.')
  const vue = await lireLina(userId)
  const devise = vue.devise

  if (entree.agent === 'cro') {
    const paniers = vue.paniers
    if (entree.cle !== 'paniers' || paniers === null || paniers.erreur !== undefined || paniers.courant.nombre === 0) {
      throw notFound('Ce point n’est plus d’actualité.')
    }
    const question = `Lina vous transmet une mesure : ${nombreLisible(paniers.courant.nombre)} paniers abandonnés en ${paniers.jours} jours (${argent(paniers.courant.valeurCents, devise)}), dont ${nombreLisible(paniers.courant.recuperes)} finalement payés. Qu’est-ce qui, dans le tunnel d’achat (panier, livraison, paiement), peut faire abandonner ? Par quoi commencer ? Ce sont des chiffres observés, pas une cause prouvée.`
    return askVisibility(userId, { siteId: entree.siteId, agent: 'cro', question: couper(question, QUESTION_MAX), history: [] }, locale, {
      demandePar: 'lina',
    })
  }

  const campagne = vue.campagnes.find((un) => un.cle === entree.cle)
  if (campagne === undefined) throw notFound('Cette campagne n’est plus d’actualité.')
  const segment = vue.segments.find((un) => un.cle === campagne.segment)
  const profil =
    segment === undefined
      ? `${nombreLisible(campagne.audience)} ${campagne.audienceLibelle}`
      : `${segment.nom.toLowerCase()} (${segment.critere.toLowerCase()}) : ${nombreLisible(campagne.audience)} ${campagne.audienceLibelle}, panier moyen ${segment.panierMoyenCents === null ? 'inconnu' : argent(segment.panierMoyenCents, devise)}`
  const etapes = campagne.etapes.map((etape) => `${etape.quand} — ${etape.contenu}`).join(' ; ')
  const question = `Lina vous confie une campagne : « ${campagne.titre} ». Audience : ${profil}. Objectif : ${campagne.objectif} Angle : ${campagne.message} Séquence : ${etapes}. ${campagne.remise} Pour chaque email, proposez un objet, un préheader, le corps en version courte et en version longue, et un appel à l’action. Écrivez pour ce segment, sans inventer de produit, de chiffre ni de témoignage, et sans promettre de résultat.`
  return askVisibility(userId, { siteId: entree.siteId, agent: 'content', question: couper(question, QUESTION_MAX), history: [] }, locale, {
    demandePar: 'lina',
  })
}
