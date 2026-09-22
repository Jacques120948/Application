import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import {
  abandonnerPlan,
  fixerEnchere,
  preparerCampagne,
  retirerDuPlan,
} from '@/server/ads/creation'
import { creerCampagne } from '@/server/ads/actions'
import { readDashboard } from '@/server/audit/service'
import { auPasFacturable } from '@/lib/pas-facturable'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Préparer une campagne, l'abandonner, ou la créer.
 *
 * Trois gestes bien séparés, et la séparation est la garantie. « Préparer » ne touche pas à
 * Google : elle écrit en base un plan que la personne relit. « Créer » ne prend qu'un
 * identifiant de plan — jamais son contenu — de sorte que ce qui part chez Google est
 * exactement ce qui a été affiché. Un plan qui ferait l'aller-retour par le navigateur
 * laisserait n'importe quelle page modifiée créer la campagne de son choix, avec son propre
 * budget et sa propre adresse d'arrivée.
 *
 * L'adresse d'arrivée autorisée est calculée ici, à partir du site suivi, et passée au
 * garde-fou. Elle ne vient pas du navigateur pour la même raison : sans quoi la
 * vérification consisterait à demander à la page si elle s'autorise.
 */
const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('preparer'),
    nom: z.string().min(1).max(120),
    /** En unités de la devise du compte, pas en micros : c'est ce que la personne saisit. */
    budget: z.number().positive().max(100_000),
    urlFinale: z.string().url().max(2_000),
    /**
     * Le coût par clic, facultatif. Absent, Naya le calcule sur les prix du planificateur ;
     * quand Google n'en donne aucun, le plan sort sans enchère et l'écran la demande.
     */
    enchere: z.number().positive().max(1_000).optional(),
  }),
  z.object({ action: z.literal('creer'), planId: z.string().uuid() }),
  z.object({
    action: z.literal('retirer'),
    planId: z.string().uuid(),
    /** Le texte du mot-clé. Un rang serait faux dès que deux écrans regardent le plan. */
    texte: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal('encherir'),
    planId: z.string().uuid(),
    enchere: z.number().positive().max(1_000),
  }),
  z.object({ action: z.literal('abandonner'), planId: z.string().uuid() }),
])

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:campagne:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))

    if (demande.action === 'abandonner') {
      await abandonnerPlan(user.id, demande.planId)
      return ok({ ok: true })
    }

    if (demande.action === 'retirer') {
      const issue = await retirerDuPlan(user.id, demande.planId, demande.texte)
      return ok(issue.ok ? { ok: true, plan: issue.plan } : { ok: false, raison: issue.raison })
    }

    if (demande.action === 'encherir') {
      /*
       * Arrondi au centime avant d'être enregistré, et non au moment de l'envoi : ce que la
       * personne relit sur son plan doit être exactement ce qui partira chez Google.
       */
      const issue = await fixerEnchere(
        user.id,
        demande.planId,
        auPasFacturable(demande.enchere * 1_000_000),
      )
      return ok(issue.ok ? { ok: true, plan: issue.plan } : { ok: false, raison: issue.raison })
    }

    const site = await readDashboard(user.id).catch(() => null)

    if (demande.action === 'creer') {
      /*
       * Les domaines de la personne, calculés côté serveur. Les demander au navigateur
       * reviendrait à faire valider l'adresse d'arrivée par la page qui la propose.
       */
      const hotes = site === null ? [] : [site.site.host]
      const issue = await creerCampagne(user.id, demande.planId, hotes)
      if (!issue.ok) return ok({ ok: false, raison: issue.raison })
      return ok({ ok: true, action: issue.action })
    }

    const origin = site === null ? null : `https://${site.site.host}`
    const bilan = await preparerCampagne(
      user.id,
      {
        nom: demande.nom,
        budgetMicros: Math.round(demande.budget * 1_000_000),
        urlFinale: demande.urlFinale,
        enchereMicros: demande.enchere === undefined ? 0 : Math.round(demande.enchere * 1_000_000),
      },
      origin,
      'fr',
    )
    return ok({ ok: true, bilan })
  } catch (error) {
    return fail(error)
  }
}
