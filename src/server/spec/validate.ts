import { validation } from '@/lib/errors'
import { appSpecSchema, type AppSpec, type Block } from './schema'

/**
 * Validation en deux temps.
 *
 * 1. Zod vérifie la *forme* : types, longueurs, énumérations, absence de propriété inconnue.
 * 2. `checkIntegrity` vérifie la *cohérence* : les références internes pointent vers
 *    quelque chose qui existe.
 *
 * Une AppSpec qui passe les deux étapes est rendable sans condition. C'est ce qui garantit
 * qu'une modification assistée ne peut pas casser l'application d'un utilisateur.
 */

export type IntegrityIssue = { path: string; message: string }

export const HOME_PATH = 'accueil'

export function checkIntegrity(spec: AppSpec): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []
  const pageIds = new Set<string>()
  const paths = new Set<string>()

  for (const [index, page] of spec.pages.entries()) {
    if (pageIds.has(page.id)) {
      issues.push({ path: `pages[${index}].id`, message: `Deux pages portent l'identifiant « ${page.id} ».` })
    }
    pageIds.add(page.id)
    if (paths.has(page.path)) {
      issues.push({ path: `pages[${index}].path`, message: `Deux pages partagent l'adresse « ${page.path} ».` })
    }
    paths.add(page.path)
  }

  if (!paths.has(HOME_PATH)) {
    issues.push({
      path: 'pages',
      message: `L'application doit avoir une page d'accueil dont l'adresse est « ${HOME_PATH} ».`,
    })
  }

  const modelsById = new Map(spec.dataModels.map((model) => [model.id, model]))
  if (modelsById.size !== spec.dataModels.length) {
    issues.push({ path: 'dataModels', message: 'Deux modèles de données portent le même identifiant.' })
  }

  for (const [index, item] of spec.navigation.items.entries()) {
    if (!pageIds.has(item.pageId)) {
      issues.push({
        path: `navigation.items[${index}].pageId`,
        message: `Le menu renvoie vers une page qui n'existe pas (« ${item.pageId} »).`,
      })
    }
  }

  const blockIds = new Set<string>()
  for (const [pageIndex, page] of spec.pages.entries()) {
    for (const [blockIndex, block] of page.blocks.entries()) {
      const at = `pages[${pageIndex}].blocks[${blockIndex}]`
      if (blockIds.has(block.id)) {
        issues.push({ path: `${at}.id`, message: `Deux sections portent l'identifiant « ${block.id} ».` })
      }
      blockIds.add(block.id)
      issues.push(...checkBlock(block, at, pageIds, modelsById))
    }
  }

  if (spec.monetization.model !== 'free' && spec.monetization.plans.length === 0) {
    issues.push({
      path: 'monetization.plans',
      message: 'Un modèle payant doit décrire au moins une formule.',
    })
  }

  const needsAuth =
    spec.pages.some((page) => page.requiresAuth) ||
    spec.dataModels.some((model) => model.scope === 'user')
  if (needsAuth && !spec.auth.enabled) {
    issues.push({
      path: 'auth.enabled',
      message:
        "L'application a des pages ou des données réservées : les comptes utilisateurs doivent être activés.",
    })
  }

  return issues
}

function checkBlock(
  block: Block,
  at: string,
  pageIds: ReadonlySet<string>,
  models: ReadonlyMap<string, { fields: readonly { id: string }[] }>,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []
  const pageRef = (id: string | undefined, field: string) => {
    if (id !== undefined && !pageIds.has(id)) {
      issues.push({ path: `${at}.${field}`, message: `Ce bouton renvoie vers une page qui n'existe pas.` })
    }
  }

  switch (block.type) {
    case 'hero':
      pageRef(block.ctaPageId, 'ctaPageId')
      if (block.ctaLabel !== undefined && block.ctaPageId === undefined) {
        issues.push({ path: `${at}.ctaPageId`, message: 'Ce bouton ne mène nulle part.' })
      }
      break
    case 'cta':
      pageRef(block.pageId, 'pageId')
      if (block.pageId === undefined && block.href === undefined) {
        issues.push({ path: `${at}.pageId`, message: 'Ce bouton ne mène nulle part.' })
      }
      break
    case 'recordForm': {
      const model = models.get(block.modelId)
      if (!model) {
        issues.push({ path: `${at}.modelId`, message: 'Ce formulaire utilise des données qui n\'existent pas.' })
      }
      break
    }
    case 'recordList': {
      const model = models.get(block.modelId)
      if (!model) {
        issues.push({ path: `${at}.modelId`, message: 'Cette liste utilise des données qui n\'existent pas.' })
        break
      }
      const fieldIds = new Set(model.fields.map((field) => field.id))
      if (!fieldIds.has(block.titleField)) {
        issues.push({ path: `${at}.titleField`, message: 'Cette liste affiche un champ qui n\'existe pas.' })
      }
      if (block.subtitleField !== undefined && !fieldIds.has(block.subtitleField)) {
        issues.push({ path: `${at}.subtitleField`, message: 'Cette liste affiche un champ qui n\'existe pas.' })
      }
      break
    }
    case 'richText':
    case 'features':
    case 'faq':
    case 'stats':
    case 'pricing':
    case 'auth':
      break
  }
  return issues
}

/** Analyse et valide une valeur inconnue. Lève une erreur lisible en cas d'échec. */
export function parseAppSpec(input: unknown): AppSpec {
  const parsed = appSpecSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw validation("La description de l'application est invalide.", {
      issues: parsed.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      summary: first ? `${first.path.join('.')} : ${first.message}` : undefined,
    })
  }
  const issues = checkIntegrity(parsed.data)
  if (issues.length > 0) {
    throw validation("La description de l'application est incohérente.", { issues })
  }
  return parsed.data
}
