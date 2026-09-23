import { z } from 'zod'
import { notFound, validation } from '@/lib/errors'
import { ACTIVITES, OBJECTIFS_MAX, objectif, type Activite } from '@/lib/objectifs'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'

/**
 * Les objectifs de l'entreprise, tels qu'Oria les lit.
 *
 * Deux règles, reprises du cahier des charges et de la façon dont on voudrait être traité
 * soi-même.
 *
 * **Ne jamais demander ce qu'on sait déjà.** Une boutique Shopify reliée dit déjà qu'on
 * vend en ligne : la question « boutique ou services ? » ne lui est pas posée. La réponse
 * déduite est affichée comme telle, et reste modifiable.
 *
 * **Ce qui arrive du navigateur est revalidé ici.** Un objectif inconnu, un objectif qui
 * n'a encore aucun agent, un troisième objectif : refusés, quel que soit le formulaire qui
 * les a envoyés.
 */

export type VueObjectifs = {
  objectifs: string[]
  /** Ce que la personne a dit, ou ce qu'on a déduit. Vide : ni l'un ni l'autre. */
  activite: Activite | ''
  /** Vrai quand l'activité vient d'une déduction et non d'une réponse. */
  deduite: boolean
}

function activiteValide(valeur: string): Activite | '' {
  return (ACTIVITES as readonly string[]).includes(valeur) ? (valeur as Activite) : ''
}

/** Une boutique Shopify est-elle reliée à Evoliia ? C'est la seule déduction qu'on fait. */
async function boutiqueReliee(userId: string): Promise<boolean> {
  const n = await withUserScope(userId, (tx) =>
    tx.integrationConnection.count({
      where: { userId, providerId: 'shopify', status: 'CONNECTED', target: 'EVOLIIA' },
    }),
  ).catch(() => 0)
  return n > 0
}

export async function lireObjectifs(userId: string, siteId: string): Promise<VueObjectifs> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { objectifs: true, activite: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  // Un objectif retiré du catalogue depuis qu'il a été choisi ne compte plus.
  const objectifs = site.objectifs.filter((id) => objectif(id) !== undefined)
  const dite = activiteValide(site.activite)
  if (dite !== '') return { objectifs, activite: dite, deduite: false }
  if (await boutiqueReliee(userId)) return { objectifs, activite: 'boutique', deduite: true }
  return { objectifs, activite: '', deduite: false }
}

export const objectifsInput = z.object({
  objectifs: z.array(z.string().max(40)).max(OBJECTIFS_MAX),
  activite: z.enum(['', ...ACTIVITES]).optional(),
})

export async function enregistrerObjectifs(
  userId: string,
  siteId: string,
  entree: z.infer<typeof objectifsInput>,
): Promise<VueObjectifs> {
  const propres = [...new Set(entree.objectifs)]
  for (const id of propres) {
    const trouve = objectif(id)
    if (trouve === undefined) throw validation('Objectif inconnu.')
    if (trouve.indisponible !== '') throw validation(trouve.indisponible)
  }

  const modifies = await withUserScope(userId, (tx) =>
    tx.site.updateMany({
      where: { id: siteId, userId, deletedAt: null },
      data: {
        objectifs: propres,
        ...(entree.activite === undefined ? {} : { activite: entree.activite }),
      },
    }),
  )
  if (modifies.count === 0) throw notFound('Ce site est introuvable.')
  logger.info('objectifs enregistrés', { userId, siteId, objectifs: propres.length })
  return lireObjectifs(userId, siteId)
}
