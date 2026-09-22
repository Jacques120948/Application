import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { after } from 'next/server'
import {
  ajouterPrompt,
  basculerPrompt,
  choisirPlateformes,
  etatPassage,
  ouvrirPassage,
  poursuivrePassage,
  proposerQuestions,
  supprimerPrompt,
} from '@/server/audit/visibilite-ia'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les questions suivies, et le relevé lui-même.
 *
 * Une seule route pour quatre gestes, distingués par `geste` : ajouter, allumer, retirer,
 * relever. Ils portent tous sur le même objet et le même droit ; les éclater en quatre
 * adresses aurait multiplié les points à protéger sans rien clarifier.
 *
 * `relever` est la seule qui dépense. Elle est bornée en durée parce qu'elle interroge
 * plusieurs assistants en série, et en fréquence parce qu'un double clic ne doit pas payer
 * deux fois.
 */
export const maxDuration = 300

const input = z.discriminatedUnion('geste', [
  z.object({
    geste: z.literal('ajouter'),
    texte: z.string().min(8).max(300),
    theme: z.string().max(60).optional(),
  }),
  z.object({ geste: z.literal('basculer'), promptId: z.string().uuid(), actif: z.boolean() }),
  z.object({ geste: z.literal('retirer'), promptId: z.string().uuid() }),
  z.object({ geste: z.literal('relever') }),
  z.object({ geste: z.literal('proposer'), locale: z.string().max(5).optional() }),
  z.object({ geste: z.literal('reprendre') }),
  /*
   * Les assistants suivis. Bornés à huit noms courts : ce qui arrive ici ne sert qu'à
   * désigner, et le serveur refiltre sur la liste du code — un nom inconnu est ignoré, pas
   * rattrapé.
   */
  z.object({ geste: z.literal('plateformes'), plateformes: z.array(z.string().max(20)).max(8) }),
])

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { siteId } = await context.params
    const demande = input.parse(await readJson(request))

    if (demande.geste === 'relever') {
      consume(`visibilite-ia:${user.id}`, RULES.aiOperation)
      /*
       * On ouvre le passage, on répond, puis on travaille.
       *
       * `after` laisse la fonction vivre après la réponse : la personne peut fermer
       * l'onglet, et les réponses continuent d'arriver. Ce qui est écrit reste écrit, donc
       * une fonction coupée au milieu ne perd rien — le reste se reprend à l'ouverture
       * suivante de l'écran, ou à la tournée de la nuit.
       */
      const etat = await ouvrirPassage(user.id, siteId)
      if (etat.enCours) {
        after(async () => {
          await poursuivrePassage(user.id, siteId).catch(() => null)
        })
      }
      return ok({ etat })
    }

    if (demande.geste === 'reprendre') {
      consume(`visibilite-ia:${user.id}`, RULES.aiOperation)
      const etat = await etatPassage(user.id, siteId)
      if (etat.enCours) {
        after(async () => {
          await poursuivrePassage(user.id, siteId).catch(() => null)
        })
      }
      return ok({ etat })
    }

    if (demande.geste === 'proposer') {
      consume(`visibilite-ia:proposer:${user.id}`, RULES.aiOperation)
      return ok({
        questions: await proposerQuestions(user.id, siteId, demande.locale ?? 'fr'),
      })
    }

    consume(`visibilite-ia:prompts:${user.id}`, RULES.aiOperation)
    if (demande.geste === 'plateformes') {
      return ok({ plateformes: await choisirPlateformes(user.id, siteId, demande.plateformes) })
    }
    if (demande.geste === 'ajouter') {
      return ok({
        prompt: await ajouterPrompt(user.id, siteId, demande.texte, demande.theme ?? ''),
      })
    }
    if (demande.geste === 'basculer') {
      await basculerPrompt(user.id, demande.promptId, demande.actif)
      return ok({ bascule: true })
    }
    await supprimerPrompt(user.id, demande.promptId)
    return ok({ retire: true })
  } catch (error) {
    return fail(error)
  }
}
