import { SPEC_VERSION, type AppSpec, type Block, type Page } from './schema'
import { HOME_PATH, parseAppSpec } from './validate'

/**
 * Assemblage du plan et du contenu des pages en une AppSpec valide.
 *
 * La génération se fait en plusieurs appels (voir src/server/ai/schemas.ts). Chaque appel
 * est valide isolément, mais rien ne garantit la cohérence entre eux : une liste peut
 * viser un modèle qui n'existe pas, un bouton pointer vers une page absente, deux sections
 * porter le même identifiant.
 *
 * Ce module répare **de façon déterministe** ce qui est réparable, puis soumet le résultat
 * à la validation stricte. Réparer plutôt que redemander évite un aller-retour payant, et
 * le fait de façon reproductible : deux assemblages identiques donnent le même résultat.
 */

export type PlanPage = {
  id: string
  title: string
  path: string
  requiresAuth: boolean
}

export type AssembleInput = {
  name: string
  tagline: string
  description: string
  locale: AppSpec['locale']
  theme: AppSpec['theme']
  auth: AppSpec['auth']
  dataModels: AppSpec['dataModels']
  navigation: AppSpec['navigation']
  monetization: AppSpec['monetization']
  pages: PlanPage[]
  /** Sections produites pour chaque page, indexées par identifiant de page. */
  blocksByPage: ReadonlyMap<string, Block[]>
}

export function slugifyId(value: string, fallback: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : fallback
}

function unique(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) {
    taken.add(candidate)
    return candidate
  }
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const next = `${candidate}-${suffix}`.slice(0, 48)
    if (!taken.has(next)) {
      taken.add(next)
      return next
    }
  }
  throw new Error('Impossible de rendre cet identifiant unique.')
}

export function assembleSpec(input: AssembleInput): AppSpec {
  const takenPageIds = new Set<string>()
  const takenPaths = new Set<string>()
  const takenBlockIds = new Set<string>()

  // 1. Identifiants et chemins de pages : normalisés puis rendus uniques.
  const idMap = new Map<string, string>()
  const headers = input.pages.slice(0, 12).map((page, index) => {
    const id = unique(slugifyId(page.id, `page-${index + 1}`), takenPageIds)
    idMap.set(page.id, id)
    return {
      id,
      original: page.id,
      title: page.title,
      path: unique(slugifyId(page.path, `page-${index + 1}`), takenPaths),
      requiresAuth: page.requiresAuth,
    }
  })

  // 2. Une page d'accueil est obligatoire : la première la devient si nécessaire.
  const first = headers[0]
  if (first !== undefined && !headers.some((page) => page.path === HOME_PATH)) {
    takenPaths.delete(first.path)
    first.path = HOME_PATH
    takenPaths.add(HOME_PATH)
  }

  const modelsById = new Map(input.dataModels.map((model) => [model.id, model]))
  const pageIds = new Set(headers.map((page) => page.id))

  // 3. Contenu : on écarte ce qui référence quelque chose d'inexistant.
  const pages: Page[] = []
  for (const header of headers) {
    const raw = input.blocksByPage.get(header.original) ?? input.blocksByPage.get(header.id) ?? []
    const blocks: Block[] = []

    for (const [index, block] of raw.slice(0, 20).entries()) {
      const repaired = repairBlock(block, {
        pageId: header.id,
        index,
        pageIds,
        idMap,
        modelsById,
        takenBlockIds,
      })
      if (repaired !== null) blocks.push(repaired)
    }

    if (blocks.length === 0) {
      // Une page vide est invalide : on lui donne un contenu minimal mais honnête.
      blocks.push({
        id: unique(`${header.id}-intro`, takenBlockIds),
        type: 'richText',
        title: header.title,
        body: input.description,
      })
    }

    pages.push({
      id: header.id,
      title: header.title,
      path: header.path,
      requiresAuth: header.requiresAuth,
      blocks,
    })
  }

  // 4. Menu : uniquement des pages existantes, et jamais vide.
  const navItems = input.navigation.items
    .map((item) => ({ ...item, pageId: idMap.get(item.pageId) ?? item.pageId }))
    .filter((item) => pageIds.has(item.pageId))
    .slice(0, 7)
  const navigation: AppSpec['navigation'] = {
    style: input.navigation.style,
    items:
      navItems.length > 0
        ? navItems
        : pages.slice(0, 7).map((page) => ({ pageId: page.id, label: page.title })),
  }

  // 5. Comptes : obligatoires dès qu'une page ou des données sont réservées.
  const needsAuth =
    pages.some((page) => page.requiresAuth) ||
    input.dataModels.some((model) => model.scope === 'user')
  const auth = needsAuth ? { enabled: true, allowSignup: true } : input.auth

  // 6. Monétisation : un modèle payant sans formule n'a pas de sens.
  const monetization =
    input.monetization.model !== 'free' && input.monetization.plans.length === 0
      ? { ...input.monetization, model: 'free' as const }
      : input.monetization

  return parseAppSpec({
    specVersion: SPEC_VERSION,
    name: input.name,
    tagline: input.tagline,
    description: input.description,
    locale: input.locale,
    theme: input.theme,
    auth,
    dataModels: input.dataModels,
    pages,
    navigation,
    monetization,
  })
}

type RepairContext = {
  pageId: string
  index: number
  pageIds: ReadonlySet<string>
  idMap: ReadonlyMap<string, string>
  modelsById: ReadonlyMap<string, { fields: readonly { id: string }[] }>
  takenBlockIds: Set<string>
}

/** Répare une section, ou renvoie `null` si elle est irrécupérable. */
function repairBlock(block: Block, context: RepairContext): Block | null {
  const id = unique(
    slugifyId(block.id, `${context.pageId}-${context.index + 1}`),
    context.takenBlockIds,
  )
  const resolvePage = (pageId: string | undefined): string | undefined => {
    if (pageId === undefined) return undefined
    const mapped = context.idMap.get(pageId) ?? pageId
    return context.pageIds.has(mapped) ? mapped : undefined
  }

  switch (block.type) {
    case 'hero': {
      const target = resolvePage(block.ctaPageId)
      const { ctaPageId: _ignoredPage, ctaLabel: _ignoredLabel, ...rest } = block
      return target === undefined
        ? { ...rest, id }
        : { ...rest, id, ctaLabel: block.ctaLabel ?? 'Commencer', ctaPageId: target }
    }
    case 'cta': {
      const target = resolvePage(block.pageId)
      if (target === undefined && block.href === undefined) return null
      const { pageId: _ignored, ...rest } = block
      return target === undefined ? { ...rest, id } : { ...rest, id, pageId: target }
    }
    case 'recordForm':
      return context.modelsById.has(block.modelId) ? { ...block, id } : null
    case 'recordList': {
      const model = context.modelsById.get(block.modelId)
      if (model === undefined) return null
      const fieldIds = model.fields.map((field) => field.id)
      const titleField = fieldIds.includes(block.titleField) ? block.titleField : fieldIds[0]
      if (titleField === undefined) return null
      const subtitleField =
        block.subtitleField !== undefined && fieldIds.includes(block.subtitleField)
          ? block.subtitleField
          : undefined
      const { subtitleField: _ignored, ...rest } = block
      return subtitleField === undefined
        ? { ...rest, id, titleField }
        : { ...rest, id, titleField, subtitleField }
    }
    case 'richText':
    case 'features':
    case 'faq':
    case 'stats':
    case 'pricing':
    case 'auth':
      return { ...block, id }
  }
}
