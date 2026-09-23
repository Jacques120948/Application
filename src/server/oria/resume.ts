import { membre } from '@/lib/equipe'
import { OBJECTIFS } from '@/lib/objectifs'
import { notFound } from '@/lib/errors'
import { resumerOria } from '@/server/ai/operations'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { lireCockpit, type Cockpit } from './cockpit'
import { lireRapport, type RapportSemaine } from './rapport'

/**
 * Le résumé d'Oria : la seule chose qu'elle écrive, et la seule qui coûte.
 *
 * Tout ce qu'il dit est déjà sur l'écran, compté et classé. Le modèle ne fait que le dire
 * en cinq phrases, et c'est pour cela qu'il est facultatif : le cockpit et le rapport se
 * lisent sans lui. On le demande quand on veut la version parlée — pour la lire sur un
 * téléphone, la transmettre, ou simplement ne pas avoir à parcourir les blocs.
 *
 * Trois règles de dépense.
 *
 * **Jamais sans demande.** Aucun résumé ne s'écrit à l'ouverture d'un écran : le cockpit
 * se recharge dix fois par jour, et dix résumés identiques coûteraient dix fois.
 *
 * **Jamais deux fois pour rien.** Un résumé écrit est conservé et se relit gratuitement.
 * Un second clic dans la minute rend le premier au lieu d'en payer un autre.
 *
 * **Rien que les faits.** Le modèle reçoit ce que l'écran montre — des états, des titres,
 * des écarts — et rien de la matière des spécialistes. Ni adresse, ni identifiant, ni
 * contenu de page : ce qui n'est pas nécessaire à la tâche ne part pas chez un tiers.
 */

export type Genre = 'jour' | 'semaine'

export type ResumeVu = {
  phrases: string[]
  createdAt: Date
  creditsSpent: number
}

/** En deçà, un second clic rend le résumé qu'on vient de payer. */
const DOUBLON_MS = 60_000

function nom(id: string): string {
  return membre(id)?.name ?? id
}

/** Ce qu'Oria voit aujourd'hui, réduit à ce qu'un résumé peut dire. */
export function faitsDuJour(cockpit: Pick<Cockpit, 'objectifs' | 'canaux' | 'priorites' | 'signaux'>): Record<string, unknown> {
  return {
    objectifs: cockpit.objectifs.objectifs
      .map((id) => OBJECTIFS.find((un) => un.id === id)?.label)
      .filter((label): label is string => label !== undefined),
    canaux: cockpit.canaux.map((canal) => ({
      canal: canal.nom,
      etat: canal.etat === 'inconnu' ? 'non relié ou non mesuré' : canal.etat,
      pourquoi: canal.pourquoi,
    })),
    priorites_dans_l_ordre: cockpit.priorites.map((signal, rang) => ({
      rang: rang + 1,
      titre: signal.titre,
      releve_par: signal.sources.map(nom),
      urgence: signal.urgence,
      pourquoi: signal.pourquoi,
      a_faire: signal.quoiFaire,
      donnees: signal.mesure,
    })),
    points_ouverts_en_tout: cockpit.signaux.length,
    critiques: cockpit.signaux.filter((signal) => signal.urgence === 'critique').length,
  }
}

/** La semaine, réduite à ce qu'un résumé peut dire. */
export function faitsDeLaSemaine(rapport: RapportSemaine): Record<string, unknown> {
  return {
    periode: { du: rapport.depuis.toISOString().slice(0, 10), au: rapport.jusqua.toISOString().slice(0, 10) },
    resultats: rapport.resultats.map((un) => ({
      mesure: un.quoi,
      semaine_precedente: un.avant === null ? null : Math.round(un.avant * 100) / 100,
      cette_semaine: un.apres === null ? null : Math.round(un.apres * 100) / 100,
      ecart_pourcent: un.ecart === null ? null : Math.round(un.ecart * 100),
      lecture: un.sens,
      unite: un.unite,
    })),
    victoires: rapport.victoires,
    points_d_attention: rapport.attention,
    actions_realisees: rapport.actions.map((un) => un.quoi),
    priorites_semaine_prochaine: rapport.priorites.map((un) => ({
      titre: un.signal.titre,
      avec: un.aide.map(nom),
    })),
    non_disponible: rapport.absents,
  }
}

/** Le dernier résumé de ce genre, ou `null` s'il n'y en a jamais eu. Gratuit. */
export async function dernierResume(
  userId: string,
  genre: Genre,
  siteId: string | null,
): Promise<ResumeVu | null> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.oriaResume.findFirst({
      where: { userId, genre, siteId },
      orderBy: { createdAt: 'desc' },
      select: { texte: true, createdAt: true, creditsSpent: true },
    }),
  )
  if (ligne === null) return null
  return {
    phrases: ligne.texte.split('\n').filter((phrase) => phrase.trim() !== ''),
    createdAt: ligne.createdAt,
    creditsSpent: ligne.creditsSpent,
  }
}

/**
 * Écrit un résumé, sur demande, et le conserve.
 *
 * Le droit passe avant la dépense : quelqu'un dont l'offre n'ouvre pas Oria est refusé
 * avant tout appel. Le solde est vérifié par l'opération elle-même, comme pour toute
 * opération facturée du produit.
 */
export async function ecrireResume(
  userId: string,
  genre: Genre,
  locale: string,
  siteId?: string,
): Promise<ResumeVu> {
  requireFeature(await getEntitlements(userId), 'oria_agent')
  consume(`oria-resume:${userId}`, RULES.aiOperation)

  const cockpit = await lireCockpit(userId, locale, siteId)
  const site = cockpit.site?.id ?? null
  if (siteId !== undefined && site !== siteId) throw notFound('Ce site est introuvable.')

  const recent = await dernierResume(userId, genre, site)
  if (recent !== null && Date.now() - +recent.createdAt < DOUBLON_MS) return recent

  const faits =
    genre === 'jour'
      ? faitsDuJour(cockpit)
      : faitsDeLaSemaine(await lireRapport(userId, locale, site ?? undefined))

  const resultat = await resumerOria({ userId, locale, genre, faits })
  const phrases = resultat.value.phrases.map((phrase) => phrase.trim()).filter((phrase) => phrase !== '')

  const ligne = await withUserScope(userId, (tx) =>
    tx.oriaResume.create({
      data: {
        userId,
        siteId: site,
        genre,
        texte: phrases.join('\n'),
        fondement: faits as object,
        creditsSpent: resultat.creditsSpent,
      },
      select: { createdAt: true },
    }),
  )
  logger.info('résumé d’Oria écrit', { genre, phrases: phrases.length, credits: resultat.creditsSpent })
  return { phrases, createdAt: ligne.createdAt, creditsSpent: resultat.creditsSpent }
}
