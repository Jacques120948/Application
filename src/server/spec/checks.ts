import type { AppSpec, Block } from './schema'
import { HOME_PATH } from './validate'

/**
 * Analyse de préparation à la publication (exigences 15 et 16).
 *
 * Ces contrôles sont **déterministes** : ils ne consomment aucun crédit et donnent
 * toujours le même résultat pour la même application. L'assistant IA n'intervient que
 * si l'utilisateur demande une correction.
 */

export type CheckStatus = 'ok' | 'warn' | 'error'

export type CheckResult = {
  id: string
  /** Libellé lisible par un débutant. */
  label: string
  status: CheckStatus
  /** Ce qu'il faut faire, formulé comme une action. */
  hint?: string
  /** Vrai quand l'assistant peut corriger seul (exigence 16). */
  autoFixable: boolean
}

export type CheckReport = {
  score: number
  results: CheckResult[]
  counts: { ok: number; warn: number; error: number }
}

const PLACEHOLDER_PATTERN = /(lorem ipsum|à compléter|a completer|texte ici|todo|xxx+)/i

function blockText(block: Block): string[] {
  switch (block.type) {
    case 'hero':
      return [block.title, block.subtitle, block.ctaLabel ?? '']
    case 'richText':
      return [block.title ?? '', block.body]
    case 'features':
      return [block.title ?? '', ...block.items.flatMap((item) => [item.title, item.body])]
    case 'faq':
      return [block.title ?? '', ...block.items.flatMap((item) => [item.question, item.answer])]
    case 'stats':
      return [...block.items.flatMap((item) => [item.label, item.value])]
    case 'cta':
      return [block.title, block.body ?? '', block.label]
    case 'pricing':
      return [block.title ?? '', block.note ?? '']
    case 'recordForm':
      return [block.title ?? '', block.submitLabel, block.successMessage]
    case 'recordList':
      return [block.title ?? '', block.emptyText]
    case 'auth':
      return [block.title, block.body ?? '']
  }
}

/** Luminance relative, formule WCAG. */
function luminance(hex: string): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = channel(Number.parseInt(hex.slice(1, 3), 16))
  const g = channel(Number.parseInt(hex.slice(3, 5), 16))
  const b = channel(Number.parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

export function runChecks(spec: AppSpec): CheckReport {
  const results: CheckResult[] = []
  const add = (result: CheckResult) => results.push(result)

  // Structure
  const hasHome = spec.pages.some((page) => page.path === HOME_PATH)
  add({
    id: 'home',
    label: "Votre application a une page d'accueil",
    status: hasHome ? 'ok' : 'error',
    autoFixable: false,
    ...(hasHome ? {} : { hint: "Ajoutez une page d'accueil." }),
  })

  const navPageIds = new Set(spec.navigation.items.map((item) => item.pageId))
  const orphans = spec.pages.filter((page) => !navPageIds.has(page.id))
  add({
    id: 'navigation',
    label: 'Toutes vos pages sont accessibles depuis le menu',
    status: orphans.length === 0 ? 'ok' : 'warn',
    autoFixable: true,
    ...(orphans.length === 0
      ? {}
      : { hint: `${orphans.length} page(s) n'apparaissent pas dans le menu.` }),
  })

  // Contenu
  const allText = spec.pages.flatMap((page) => page.blocks.flatMap(blockText)).filter(Boolean)
  const placeholders = allText.filter((text) => PLACEHOLDER_PATTERN.test(text))
  add({
    id: 'placeholder',
    label: 'Vos textes sont rédigés, sans texte de remplissage',
    status: placeholders.length === 0 ? 'ok' : 'warn',
    autoFixable: true,
    ...(placeholders.length === 0
      ? {}
      : { hint: `${placeholders.length} texte(s) semblent provisoires.` }),
  })

  const emptyPages = spec.pages.filter((page) => page.blocks.length === 0)
  add({
    id: 'empty-pages',
    label: 'Aucune page vide',
    status: emptyPages.length === 0 ? 'ok' : 'error',
    autoFixable: true,
    ...(emptyPages.length === 0 ? {} : { hint: 'Certaines pages ne contiennent rien.' }),
  })

  // Identité
  const named = spec.name.trim().length >= 2 && spec.tagline.trim().length >= 10
  add({
    id: 'identity',
    label: 'Votre application a un nom et une phrase de présentation',
    status: named ? 'ok' : 'warn',
    autoFixable: true,
    ...(named ? {} : { hint: 'Complétez le nom et la phrase de présentation.' }),
  })

  // Lisibilité
  const ratio = contrastRatio(spec.theme.colors.text, spec.theme.colors.background)
  add({
    id: 'contrast',
    label: 'Vos textes sont lisibles sur le fond choisi',
    status: ratio >= 4.5 ? 'ok' : 'error',
    autoFixable: true,
    ...(ratio >= 4.5
      ? {}
      : { hint: 'Le contraste est insuffisant : assombrissez le texte ou éclaircissez le fond.' }),
  })

  // Données
  const usedModels = new Set<string>()
  for (const page of spec.pages) {
    for (const block of page.blocks) {
      if (block.type === 'recordForm' || block.type === 'recordList') usedModels.add(block.modelId)
    }
  }
  const unusedModels = spec.dataModels.filter((model) => !usedModels.has(model.id))
  add({
    id: 'data-usage',
    label: 'Toutes vos données sont utilisées dans une page',
    status: unusedModels.length === 0 ? 'ok' : 'warn',
    autoFixable: true,
    ...(unusedModels.length === 0
      ? {}
      : { hint: `${unusedModels.length} jeu(x) de données ne sont affichés nulle part.` }),
  })

  const formModels = new Set<string>()
  const listModels = new Set<string>()
  for (const page of spec.pages) {
    for (const block of page.blocks) {
      if (block.type === 'recordForm') formModels.add(block.modelId)
      if (block.type === 'recordList') listModels.add(block.modelId)
    }
  }
  const writeOnly = [...formModels].filter((id) => !listModels.has(id))
  add({
    id: 'data-visible',
    label: 'Ce que vos visiteurs saisissent leur est montré',
    status: writeOnly.length === 0 ? 'ok' : 'warn',
    autoFixable: true,
    ...(writeOnly.length === 0
      ? {}
      : { hint: 'Un formulaire enregistre des données qui ne sont affichées nulle part.' }),
  })

  // Comptes
  const needsAuth =
    spec.pages.some((page) => page.requiresAuth) ||
    spec.dataModels.some((model) => model.scope === 'user')
  const hasAuthBlock = spec.pages.some((page) => page.blocks.some((block) => block.type === 'auth'))
  add({
    id: 'auth-entry',
    label: 'Vos visiteurs peuvent créer un compte et se connecter',
    status: !needsAuth || hasAuthBlock ? 'ok' : 'error',
    autoFixable: true,
    ...(!needsAuth || hasAuthBlock
      ? {}
      : { hint: 'Ajoutez une page de connexion : certaines pages sont réservées.' }),
  })

  // Monétisation
  const paid = spec.monetization.model !== 'free'
  const hasPlans = spec.monetization.plans.length > 0
  add({
    id: 'monetization',
    label: 'Votre modèle économique est défini',
    status: !paid || hasPlans ? 'ok' : 'error',
    autoFixable: false,
    ...(!paid || hasPlans ? {} : { hint: 'Décrivez au moins une formule tarifaire.' }),
  })

  const pricingShown = spec.pages.some((page) =>
    page.blocks.some((block) => block.type === 'pricing'),
  )
  add({
    id: 'pricing-visible',
    label: 'Vos tarifs sont visibles par vos visiteurs',
    status: !paid || pricingShown ? 'ok' : 'warn',
    autoFixable: true,
    ...(!paid || pricingShown ? {} : { hint: 'Ajoutez une section tarifs à une page.' }),
  })

  // Confidentialité
  const hasPrivacy = spec.pages.some(
    (page) => page.path.includes('confidentialite') || page.path.includes('privacy'),
  )
  const collectsData = spec.dataModels.length > 0 || spec.auth.enabled
  add({
    id: 'privacy',
    label: 'Votre politique de confidentialité est en ligne',
    status: !collectsData || hasPrivacy ? 'ok' : 'warn',
    autoFixable: true,
    ...(!collectsData || hasPrivacy
      ? {}
      : {
          hint: 'Votre application collecte des informations : une page de confidentialité est nécessaire.',
        }),
  })

  const counts = {
    ok: results.filter((r) => r.status === 'ok').length,
    warn: results.filter((r) => r.status === 'warn').length,
    error: results.filter((r) => r.status === 'error').length,
  }

  // Un avertissement compte pour un demi-point, une erreur pour zéro.
  const score = Math.round(((counts.ok + counts.warn * 0.5) / results.length) * 100)

  return { score, results, counts }
}
