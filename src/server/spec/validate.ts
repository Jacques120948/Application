import { formulaFields, FormulaError, parseFormula } from '@/lib/formula'
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

  /*
   * Les renvois d'un modèle vers un autre. Un renvoi qui pointe dans le vide n'est pas une
   * imprécision : à la saisie il n'offrirait aucun choix, et à la lecture il n'afficherait
   * rien. Mieux vaut l'arrêter avant la publication.
   */
  for (const [index, model] of spec.dataModels.entries()) {
    const fieldIds = new Set(model.fields.map((field) => field.id))
    if (model.labelField !== undefined && !fieldIds.has(model.labelField)) {
      issues.push({
        path: `dataModels[${index}].labelField`,
        message: 'Ces données se nomment par un champ qui n\'existe pas.',
      })
    }
    const champsSaisis = new Set(
      model.fields.filter((field) => field.type !== 'computed').map((field) => field.id),
    )
    for (const [fieldIndex, field] of model.fields.entries()) {
      const chemin = `dataModels[${index}].fields[${fieldIndex}]`

      if (field.type === 'reference') {
        if (field.referenceModelId === undefined || !modelsById.has(field.referenceModelId)) {
          issues.push({
            path: `${chemin}.referenceModelId`,
            message: 'Ce renvoi pointe vers des données qui n\'existent pas.',
          })
        }
        continue
      }

      if (field.type !== 'computed') continue

      /*
       * Une formule est vérifiée ici, à la publication, et non à l'exécution. Une formule
       * fausse découverte par un visiteur devant un total vide serait un bug invisible du
       * créateur ; refusée à la publication, elle est un message qu'il peut corriger.
       */
      let node
      try {
        node = parseFormula(field.formula ?? '')
      } catch (error) {
        issues.push({
          path: `${chemin}.formula`,
          message: error instanceof FormulaError ? error.message : 'Cette formule est illisible.',
        })
        continue
      }

      for (const utilise of formulaFields(node)) {
        if (utilise === field.id) {
          issues.push({ path: `${chemin}.formula`, message: 'Une formule ne peut pas se calculer elle-même.' })
        } else if (!champsSaisis.has(utilise)) {
          // Un champ calculé ne peut pas en utiliser un autre : cela ouvrirait la porte aux
          // dépendances circulaires, qu'il faudrait alors détecter et expliquer.
          issues.push({
            path: `${chemin}.formula`,
            message: `La formule utilise « ${utilise} », qui n'est pas un champ saisi de ces données.`,
          })
        }
      }
    }
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
  models: ReadonlyMap<string, { fields: readonly { id: string; type: string }[] }>,
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
    case 'calendar': {
      const model = models.get(block.modelId)
      if (!model) {
        issues.push({ path: `${at}.modelId`, message: 'Ce calendrier utilise des données qui n\'existent pas.' })
        break
      }
      const champDate = model.fields.find((field) => field.id === block.dateField)
      if (champDate === undefined) {
        issues.push({ path: `${at}.dateField`, message: 'Ce calendrier place les fiches sur un champ qui n\'existe pas.' })
      } else if (champDate.type !== 'date') {
        issues.push({ path: `${at}.dateField`, message: 'Un calendrier se range sur une date.' })
      }
      const fieldIds = new Set(model.fields.map((field) => field.id))
      if (block.titleField !== undefined && !fieldIds.has(block.titleField)) {
        issues.push({ path: `${at}.titleField`, message: 'Ce calendrier affiche un champ qui n\'existe pas.' })
      }
      if (block.colorField !== undefined) {
        const champ = model.fields.find((field) => field.id === block.colorField)
        if (champ === undefined) {
          issues.push({ path: `${at}.colorField`, message: 'Ce calendrier colore selon un champ qui n\'existe pas.' })
        } else if (champ.type !== 'select') {
          issues.push({ path: `${at}.colorField`, message: 'Seul un champ à choix peut colorer un calendrier.' })
        }
      }
      break
    }
    case 'metrics': {
      for (const [itemIndex, item] of block.items.entries()) {
        const ici = `${at}.items[${itemIndex}]`
        const model = models.get(item.modelId)
        if (!model) {
          issues.push({ path: `${ici}.modelId`, message: 'Cette mesure porte sur des données qui n\'existent pas.' })
          continue
        }
        if (item.kind !== 'nombre') {
          const champ = model.fields.find((field) => field.id === item.field)
          if (champ === undefined) {
            issues.push({ path: `${ici}.field`, message: 'Cette mesure porte sur un champ qui n\'existe pas.' })
          } else if (champ.type !== 'number' && champ.type !== 'computed') {
            issues.push({ path: `${ici}.field`, message: 'On ne totalise que des nombres.' })
          }
        }
        if (item.filterField !== undefined) {
          const champ = model.fields.find((field) => field.id === item.filterField)
          if (champ === undefined) {
            issues.push({ path: `${ici}.filterField`, message: 'Cette mesure filtre sur un champ qui n\'existe pas.' })
          } else if (champ.type === 'computed') {
            // Un champ calculé n'existe pas en base : on ne peut pas comparer sa valeur
            // à une chaîne dans la condition.
            issues.push({
              path: `${ici}.filterField`,
              message: 'Une mesure ne peut pas être restreinte par un champ calculé.',
            })
          }
        }
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
      if (block.sumField !== undefined) {
        const champ = model.fields.find((field) => field.id === block.sumField)
        if (champ === undefined) {
          issues.push({ path: `${at}.sumField`, message: 'Cette liste totalise un champ qui n\'existe pas.' })
        } else if (champ.type !== 'number' && champ.type !== 'computed') {
          issues.push({ path: `${at}.sumField`, message: 'On ne totalise que des nombres.' })
        }
      }
      if (block.filterField !== undefined) {
        const champ = model.fields.find((field) => field.id === block.filterField)
        if (champ === undefined) {
          issues.push({ path: `${at}.filterField`, message: 'Cette liste filtre sur un champ qui n\'existe pas.' })
        } else if (champ.type !== 'select') {
          issues.push({
            path: `${at}.filterField`,
            message: 'On ne peut filtrer que sur un champ à choix, où les valeurs se répètent.',
          })
        }
      }
      break
    }
    case 'imageText':
      pageRef(block.ctaPageId, 'ctaPageId')
      if (block.ctaLabel !== undefined && block.ctaPageId === undefined) {
        issues.push({ path: `${at}.ctaPageId`, message: 'Ce bouton ne mène nulle part.' })
      }
      break
    case 'banner':
      pageRef(block.pageId, 'pageId')
      if (block.label !== undefined && block.pageId === undefined && block.href === undefined) {
        issues.push({ path: `${at}.pageId`, message: 'Ce bouton ne mène nulle part.' })
      }
      break
    case 'comparison':
      for (const [rowIndex, row] of block.rows.entries()) {
        if (row.values.length !== block.columns.length) {
          issues.push({
            path: `${at}.rows[${rowIndex}].values`,
            message: 'Chaque ligne du tableau doit avoir une valeur par colonne.',
          })
        }
      }
      break
    case 'contact':
      if (
        block.email === undefined &&
        block.phone === undefined &&
        block.address === undefined &&
        block.hours === undefined
      ) {
        issues.push({ path: `${at}.email`, message: 'Une section contact doit donner au moins un moyen de contact.' })
      }
      break
    case 'richText':
    case 'features':
    case 'steps':
    case 'gallery':
    case 'testimonials':
    case 'team':
    case 'logos':
    case 'faq':
    case 'stats':
    case 'video':
    case 'pricing':
    case 'auth':
    case 'assistant':
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
