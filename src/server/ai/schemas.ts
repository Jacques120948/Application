import { z } from 'zod'
import { TEMPLATE_KINDS } from '@/server/spec/templates'

/**
 * Contrats de sortie de l'assistant.
 *
 * Chaque schéma sert deux fois : il contraint la réponse du modèle (sorties structurées)
 * et il type le résultat côté TypeScript. Une réponse non conforme n'atteint jamais la
 * base de données.
 */

export const blueprintSchema = z
  .object({
    /** Faux si l'idée sort du champ de ce que la plateforme sait construire. */
    feasible: z.boolean(),
    appName: z.string().min(1).max(60),
    tagline: z.string().min(1).max(160),
    concept: z.string().min(1).max(600),
    description: z.string().min(1).max(1500),
    features: z
      .array(z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(300) }))
      .min(2)
      .max(8),
    monetization: z
      .array(
        z.object({
          model: z.enum(['free', 'one_time', 'subscription', 'freemium', 'credits']),
          label: z.string().min(1).max(80),
          rationale: z.string().min(1).max(300),
        }),
      )
      .min(1)
      .max(4),
    templateKind: z.enum(TEMPLATE_KINDS),
    themePreset: z.enum(['confiance', 'nature', 'chaleur', 'elegance']),
    /** Ce que la plateforme ne sait pas faire pour cette idée. Dit franchement. */
    limitations: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict()

export type Blueprint = z.infer<typeof blueprintSchema>

export const ideasSchema = z
  .object({
    ideas: z
      .array(
        z
          .object({
            title: z.string().min(1).max(80),
            problem: z.string().min(1).max(300),
            audience: z.string().min(1).max(200),
            solution: z.string().min(1).max(400),
            features: z.array(z.string().min(1).max(120)).min(3).max(7),
            monetization: z.string().min(1).max(200),
            difficulty: z.enum(['facile', 'moyenne', 'exigeante']),
            startingCost: z.string().min(1).max(120),
            competition: z.string().min(1).max(200),
            /** Formulation obligatoire en potentiel, jamais en promesse de revenus. */
            potential: z.string().min(1).max(300),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict()

export type Ideas = z.infer<typeof ideasSchema>

/** Réponse de l'assistant à une demande de modification. */
export const editResponseSchema = z
  .object({
    /** Faux quand la demande sort du vocabulaire de la plateforme. */
    supported: z.boolean(),
    /** Message adressé à l'utilisateur, en langage courant, sans jargon. */
    reply: z.string().min(1).max(600),
    summary: z.string().min(1).max(120),
    operations: z
      .array(
        z
          .object({
            op: z.enum(['set', 'delete', 'append', 'insert', 'move']),
            path: z.string().min(1).max(300),
            value: z.unknown().optional(),
            index: z.number().int().min(0).max(200).optional(),
            from: z.number().int().min(0).max(200).optional(),
            to: z.number().int().min(0).max(200).optional(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict()

export type EditResponse = z.infer<typeof editResponseSchema>
