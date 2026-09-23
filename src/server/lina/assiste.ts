import { z } from 'zod'
import { AppError, notFound, validation } from '@/lib/errors'
import { getEntitlements } from '@/server/billing/entitlements'
import { SHOPIFY_FEATURE } from '@/server/commerce/boutique'
import { withUserScope } from '@/server/db/scope'
import { frapperJeton, lireAcces } from '@/server/integrations/providers/shopify'
import { creerSegmentShopify } from '@/server/integrations/providers/shopify-clients'
import { useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import { lireLina } from './service'

/**
 * Le mode assisté de Lina : elle recommande, la personne valide, Lina exécute.
 *
 * Deux niveaux (la spécification en prévoit un troisième, « automatique », qui n'existe pas
 * ici : rien ne part sans validation). « Conseil » : Lina recommande et prépare, la personne
 * fait tout elle-même. « Assisté » : sur un clic de validation, Lina crée le segment dans
 * Shopify. C'est sa seule écriture : une requête enregistrée, aucune fiche client modifiée,
 * aucun message envoyé. Chaque exécution est journalisée.
 *
 * La requête vient toujours du serveur (recalculée ici), jamais du navigateur.
 */

export const NIVEAUX_AUTONOMIE = ['conseil', 'assiste'] as const
export type NiveauAutonomie = (typeof NIVEAUX_AUTONOMIE)[number]

export async function lireAutonomie(userId: string): Promise<NiveauAutonomie> {
  const ligne = await withUserScope(userId, (tx) => tx.linaReglages.findUnique({ where: { userId }, select: { autonomie: true } }))
  return ligne?.autonomie === 'conseil' ? 'conseil' : 'assiste'
}

export async function enregistrerAutonomie(userId: string, niveau: NiveauAutonomie): Promise<NiveauAutonomie> {
  await withUserScope(userId, (tx) => tx.linaReglages.upsert({ where: { userId }, create: { userId, autonomie: niveau }, update: { autonomie: niveau } }))
  return niveau
}

export const executionSchema = z
  .object({
    type: z.enum(['segment', 'campagne']),
    cle: z.string().trim().min(1).max(80),
  })
  .strict()

export type ActionLina = { id: string; type: string; cle: string; nom: string; refExterne: string; createdAt: Date }

export async function lireActions(userId: string, nombre = 10): Promise<ActionLina[]> {
  return withUserScope(userId, (tx) =>
    tx.linaAction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: nombre, select: { id: true, type: true, cle: true, nom: true, refExterne: true, createdAt: true } }),
  )
}

/** L'adresse du segment dans l'administration Shopify. */
export function lienSegment(boutique: string, id: string): string {
  return `https://${boutique}/admin/customers/segments/${id.replace(/^gid:\/\/shopify\/Segment\//u, '')}`
}

export async function creerSegmentAssiste(
  userId: string,
  entree: z.infer<typeof executionSchema>,
  maintenant = new Date(),
): Promise<{ nom: string; lien: string }> {
  const { type, cle } = executionSchema.parse(entree)
  if ((await lireAutonomie(userId)) !== 'assiste') {
    throw new AppError('CONFLICT', 'Lina est réglée sur « Conseil » : elle recommande sans rien exécuter. Passez en « Assisté » pour qu’elle crée le segment.')
  }
  const vue = await lireLina(userId, { avecNova: false, maintenant })
  if (vue.vierge || vue.etat.source !== 'shopify') throw validation('La création de segments se fait dans Shopify : reliez une boutique Shopify et analysez vos clients.')
  const trouve = type === 'segment' ? vue.segments.find((segment) => segment.cle === cle) : vue.campagnes.find((campagne) => campagne.cle === cle)
  const source = trouve === undefined ? undefined : { libelle: 'nom' in trouve ? trouve.nom : trouve.titre, requete: trouve.requeteShopify }
  if (source === undefined) throw notFound('Ce segment ou cette campagne n’existe plus. Actualisez la page.')
  const requete = source.requete
  if (requete === null) throw validation('Ce segment ne s’exprime pas en requête Shopify : il ne peut pas être créé automatiquement.')

  const connexion = await useCredential(userId, 'shopify').catch(() => null)
  const acces = connexion === null ? null : lireAcces(connexion.secret)
  if (acces === null) throw validation('La connexion Shopify est absente ou abîmée. Reconnectez-la.')
  if (!(await getEntitlements(userId)).granted.includes(SHOPIFY_FEATURE)) throw validation('La connexion Shopify n’est pas incluse dans votre offre actuelle.')
  const frappe = await frapperJeton(acces)
  if (!frappe.ok) throw validation(frappe.raison)

  const nom = `Lina — ${source.libelle} (${maintenant.toISOString().slice(0, 10).split('-').reverse().join('.')})`.slice(0, 250)
  const resultat = await creerSegmentShopify(acces, frappe.jeton, nom, requete)
  if (!resultat.ok) throw validation(resultat.raison)
  await withUserScope(userId, (tx) => tx.linaAction.create({ data: { userId, type: 'segment-shopify', cle: `${type}:${cle}`, nom, refExterne: resultat.id } }))
  logger.info('segment créé par Lina sur validation', { userId })
  return { nom, lien: lienSegment(acces.boutique, resultat.id) }
}
