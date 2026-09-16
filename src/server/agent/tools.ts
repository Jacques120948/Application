import { AppError } from '@/lib/errors'
import { runChecks } from '@/server/spec/checks'
import { applyPatch, specPatchSchema, type PatchOperation } from '@/server/spec/patch'
import type { AppSpec } from '@/server/spec/schema'
import { truncationLeak } from './context'
import { describeIncidents, type Incident } from './incidents'

/**
 * Ce que l'agent a le droit de faire.
 *
 * Un agent est défini par ses outils bien plus que par ses consignes : ce qu'il ne peut
 * pas appeler, il ne peut pas le faire. La liste est donc volontairement courte, et
 * chaque outil est exécuté par le serveur, jamais par le modèle.
 *
 * Deux familles seulement.
 *
 * **Lire.** L'agent commence avec un plan de l'application, pas son contenu. S'il a
 * besoin d'une page ou d'un modèle de données, il le demande. C'est ce qui évite
 * d'envoyer toute l'application à chaque demande — et c'est aussi ce qui rend son
 * raisonnement lisible : les pages qu'il a ouvertes disent ce qu'il a regardé.
 *
 * **Proposer.** L'agent ne modifie rien lui-même. Il propose des opérations ; le serveur
 * les valide contre le schéma, les applique sur une copie de travail, et lui rend le
 * résultat — « appliqué » ou bien le motif exact du refus. Une proposition invalide ne
 * touche donc jamais l'application du créateur, et l'agent apprend de son erreur au lieu
 * de la répéter.
 *
 * Il n'y a **aucun outil d'écriture directe**, aucun accès à la base, aucun appel réseau.
 * La seule chose qui sorte de l'agent est une AppSpec valide.
 */

export type ToolName =
  | 'lire_page'
  | 'lire_modele_de_donnees'
  | 'lire_controles'
  | 'lire_incidents'
  | 'proposer_modifications'

/** Déclaration transmise au modèle. Le format est celui de l'API Claude. */
export type ToolSpec = {
  name: ToolName
  description: string
  input_schema: Record<string, unknown>
}

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'lire_page',
    description:
      "Le contenu complet d'une page de l'application, sections comprises. À utiliser avant de modifier une page dont tu n'as vu que le plan.",
    input_schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string', description: "Le « path » de la page, par exemple « accueil »." },
      },
      required: ['chemin'],
      additionalProperties: false,
    },
  },
  {
    name: 'lire_modele_de_donnees',
    description:
      "La définition complète d'un modèle de données : ses champs, leurs types, leur portée.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "L'identifiant du modèle." },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'lire_controles',
    description:
      "Le rapport des contrôles de l'application dans son état actuel : contraste, textes à compléter, images manquantes. À utiliser pour diagnostiquer un problème signalé par le créateur.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lire_incidents',
    description:
      "Ce qui a récemment échoué pour ce créateur : construction, publication, image, modification. À utiliser quand il dit qu'une action « n'a pas marché » sans pouvoir expliquer pourquoi. Ne raconte jamais de détail technique : dis ce qui s'est passé et ce qu'il peut faire.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'proposer_modifications',
    description:
      "Propose des opérations sur la description de l'application. Le serveur les valide et les applique sur une copie de travail, puis te dit si elles ont abouti. Tu peux appeler cet outil plusieurs fois ; chaque appel qui aboutit s'ajoute aux précédents.",
    input_schema: {
      type: 'object',
      properties: {
        resume: {
          type: 'string',
          description: 'Résumé en français courant, court, qui figurera dans l’historique des versions.',
        },
        operations: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['set', 'delete', 'append', 'insert', 'move'] },
              path: { type: 'string' },
              valueJson: {
                type: 'string',
                description: 'La nouvelle valeur, encodée en JSON dans une chaîne. "null" si inutile.',
              },
              index: { type: 'integer', minimum: 0, maximum: 200 },
              from: { type: 'integer', minimum: 0, maximum: 200 },
              to: { type: 'integer', minimum: 0, maximum: 200 },
            },
            required: ['op', 'path', 'valueJson', 'index', 'from', 'to'],
            additionalProperties: false,
          },
        },
      },
      required: ['resume', 'operations'],
      additionalProperties: false,
    },
  },
]

/**
 * Le plan de l'application : tout ce qu'il faut pour viser juste, rien de ce qui pèse.
 *
 * Les indices sont donnés explicitement parce que les opérations les utilisent. Un plan
 * sans indices obligerait l'agent à les deviner, et il les devinerait parfois mal.
 */
export function outline(spec: AppSpec): string {
  const pages = spec.pages
    .map((page, index) => {
      const blocks = page.blocks
        .map((block, position) => `      [${position}] ${block.type} (id « ${block.id} »)`)
        .join('\n')
      return [
        `  [${index}] « ${page.title} » — chemin « ${page.path} »${page.requiresAuth ? ', réservée aux personnes connectées' : ''}`,
        blocks,
      ].join('\n')
    })
    .join('\n')

  const models =
    spec.dataModels.length === 0
      ? '  (aucun)'
      : spec.dataModels
          .map(
            (model, index) =>
              `  [${index}] « ${model.label} » (id « ${model.id} », portée ${model.scope}) — champs : ${model.fields
                .map((field) => `${field.id}:${field.type}`)
                .join(', ')}`,
          )
          .join('\n')

  return [
    `Application « ${spec.name} » — ${spec.tagline}`,
    `Langue : ${spec.locale}. Thème : ${spec.theme.mode}, couleur principale ${spec.theme.colors.primary}.`,
    `Comptes visiteurs : ${spec.auth.enabled ? (spec.auth.allowSignup ? 'activés, inscription ouverte' : 'activés, inscription fermée') : 'désactivés'}.`,
    `Monétisation : ${spec.monetization.model}, ${spec.monetization.plans.length} formule(s).`,
    `Menu (${spec.navigation.style}) : ${spec.navigation.items.map((item) => item.label).join(' · ')}`,
    '',
    'Pages :',
    pages,
    '',
    'Modèles de données :',
    models,
  ].join('\n')
}

/** L'état de travail d'une exécution : la spécification en cours et ce qui l'a changée. */
export type Workspace = {
  spec: AppSpec
  /** Les opérations acceptées, dans l'ordre. C'est elles qui feront la version. */
  applied: PatchOperation[]
  /** Les résumés des propositions acceptées. */
  summaries: string[]
  /** Les pages que l'agent a ouvertes. Utile pour expliquer ce qu'il a regardé. */
  read: string[]
  /**
   * Ce qui a récemment échoué pour ce créateur, chargé avant la boucle.
   *
   * Lu une fois plutôt qu'à la demande, pour que l'exécution d'un outil reste ce qu'elle
   * est : une fonction pure sur l'espace de travail, sans base de données ni attente.
   */
  incidents: readonly Incident[]
}

export function newWorkspace(spec: AppSpec, incidents: readonly Incident[] = []): Workspace {
  return { spec, applied: [], summaries: [], read: [], incidents }
}

/** Ce qu'un outil renvoie au modèle : du texte, jamais un objet à interpréter. */
export type ToolOutcome = { text: string; isError: boolean }

function ok(text: string): ToolOutcome {
  return { text, isError: false }
}

function ko(text: string): ToolOutcome {
  return { text, isError: true }
}

/**
 * Convertit les opérations du modèle, dont les valeurs arrivent encodées en JSON dans une
 * chaîne, vers la forme attendue par le moteur de patch.
 */
function toOperations(raw: unknown): PatchOperation[] {
  if (!Array.isArray(raw)) throw new AppError('VALIDATION', 'Opérations manquantes.')
  return raw.map((entry) => {
    const item = entry as Record<string, unknown>
    const op = String(item.op)
    const path = String(item.path)
    if (op === 'delete') return { op: 'delete', path }
    if (op === 'move') {
      return { op: 'move', path, from: Number(item.from), to: Number(item.to) }
    }
    let value: unknown
    try {
      value = JSON.parse(String(item.valueJson))
    } catch {
      throw new AppError('VALIDATION', `La valeur de « ${path} » n'est pas du JSON valide.`)
    }
    if (op === 'insert') return { op: 'insert', path, index: Number(item.index), value }
    if (op === 'set' || op === 'append') return { op, path, value }
    throw new AppError('VALIDATION', `Opération inconnue : ${op}.`)
  })
}

/**
 * Exécute un outil. Aucune exception ne sort d'ici : un échec est une réponse, que le
 * modèle lit et dont il tient compte. C'est la différence entre un agent qui se corrige
 * et un agent qui s'arrête.
 */
export function runTool(name: string, input: unknown, workspace: Workspace): ToolOutcome {
  const args = (input ?? {}) as Record<string, unknown>

  switch (name) {
    case 'lire_page': {
      const chemin = String(args.chemin ?? '')
      const page = workspace.spec.pages.find((candidate) => candidate.path === chemin)
      if (page === undefined) {
        return ko(
          `Aucune page « ${chemin} ». Les chemins existants sont : ${workspace.spec.pages.map((item) => item.path).join(', ')}.`,
        )
      }
      if (!workspace.read.includes(chemin)) workspace.read.push(chemin)
      return ok(JSON.stringify(page))
    }

    case 'lire_modele_de_donnees': {
      const id = String(args.id ?? '')
      const model = workspace.spec.dataModels.find((candidate) => candidate.id === id)
      if (model === undefined) {
        return ko(
          `Aucun modèle « ${id} ». Les modèles existants sont : ${workspace.spec.dataModels.map((item) => item.id).join(', ') || 'aucun'}.`,
        )
      }
      return ok(JSON.stringify(model))
    }

    case 'lire_controles': {
      const report = runChecks(workspace.spec)
      const lignes = report.results
        .filter((result) => result.status !== 'ok')
        .map((result) => `- [${result.status}] ${result.label}${result.hint === undefined ? '' : ` — ${result.hint}`}`)
      return ok(
        lignes.length === 0
          ? "Tous les contrôles passent. Rien à signaler sur l'application actuelle."
          : [`Score : ${report.score}/100.`, ...lignes].join('\n'),
      )
    }

    case 'lire_incidents':
      return ok(describeIncidents(workspace.incidents))

    case 'proposer_modifications': {
      let operations: PatchOperation[]
      try {
        operations = toOperations(args.operations)
      } catch (error) {
        return ko(error instanceof AppError ? error.message : 'Opérations illisibles.')
      }
      if (operations.length === 0) return ko('Aucune opération proposée.')

      try {
        const patch = specPatchSchema.parse({
          summary: String(args.resume ?? 'Modification'),
          operations,
        })
        const fuite = truncationLeak(workspace.spec, patch.operations)
        if (fuite !== null) {
          return ko(
            `${fuite} Ouvre la page concernée avec « lire_page » pour voir le texte entier avant de le réécrire.`,
          )
        }
        // La copie de travail avance seulement si tout le lot passe : un patch à moitié
        // appliqué laisserait l'agent raisonner sur une application qui n'existe pas.
        workspace.spec = applyPatch(workspace.spec, patch)
        workspace.applied.push(...patch.operations)
        workspace.summaries.push(patch.summary)
        return ok(
          `Appliqué sur la copie de travail : ${patch.operations.length} opération(s). L'application reste valide.`,
        )
      } catch (error) {
        return ko(describeRefusal(error))
      }
    }

    default:
      return ko(`Outil inconnu : ${name}.`)
  }
}

/** Le motif d'un refus, écrit pour que le modèle sache quoi corriger. */
function describeRefusal(error: unknown): string {
  if (error instanceof AppError) {
    const issues = (error.details as { issues?: Array<{ path: string; message: string }> })?.issues
    if (Array.isArray(issues) && issues.length > 0) {
      return `Refusé : ${issues.map((issue) => `${issue.path} — ${issue.message}`).join(' ; ')}`
    }
    return `Refusé : ${error.message}`
  }
  const zod = error as { issues?: Array<{ path: Array<string | number>; message: string }> }
  if (Array.isArray(zod.issues)) {
    return `Refusé : ${zod.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
      .join(' ; ')}`
  }
  return 'Refusé : la modification produirait une application invalide.'
}
