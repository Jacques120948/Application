import sharp from 'sharp'
import { AppError, notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { getEffectivePlan } from '@/server/billing/plans'
import { appSpecSchema, type AppSpec } from '@/server/spec/schema'
import { iconSvg } from '@/server/runtime/pwa'
import { logger } from '@/server/observability/logger'
import { createZip, type ZipEntry } from './zip'
import { publicAppUrl } from '@/lib/apps-domain'

/**
 * Dossier de publication mobile.
 *
 * Ce que cette fonction fait, et ce qu'elle ne fera jamais : elle prépare tout ce qui peut
 * l'être depuis le projet — les icônes aux tailles exigées, les textes de fiche, la liste
 * de ce qui reste à faire — et elle ne promet aucune acceptation. Apple et Google décident
 * seuls, et toute formulation qui laisserait croire le contraire serait une promesse que
 * nous ne tenons pas.
 *
 * Aucun appel à un modèle : les textes viennent du projet, pas d'une génération. Le créateur
 * a déjà écrit son accroche et sa description ; la lui faire réécrire par une IA coûterait
 * un crédit pour un résultat moins fidèle.
 *
 * La limite honnête à dire : une application web installée depuis le navigateur couvre déjà
 * l'essentiel de l'usage. Les boutiques ajoutent la visibilité de leur catalogue, au prix
 * d'un compte payant, de délais de validation et, chez Google, de douze testeurs pendant
 * quatorze jours.
 */

/**
 * Tailles d'icône réclamées par les deux boutiques.
 *
 * Apple exige 1024 pour la fiche et 180 pour l'appareil ; Google exige 512 pour la fiche et
 * la série adaptative pour l'écran d'accueil. Les produire toutes évite au créateur d'aller
 * chercher un redimensionneur en ligne, étape où beaucoup abandonnent.
 */
const ICON_SIZES = [1024, 512, 192, 180, 167, 152, 120] as const

/** Longueurs maximales des champs de fiche, imposées par les boutiques. */
const LIMITS = { nom: 30, sousTitre: 30, resume: 80, description: 4000 } as const

export type MobileKitResult = {
  filename: string
  archive: Buffer
  bytes: number
  files: number
}

function trim(value: string, max: number): string {
  const propre = value.replace(/\s+/g, ' ').trim()
  return propre.length <= max ? propre : `${propre.slice(0, max - 1).trimEnd()}…`
}

/**
 * Description longue, assemblée depuis ce que le créateur a déjà écrit.
 *
 * Rien n'est inventé : l'accroche vient du thème, les fonctions viennent des blocs
 * réellement présents dans l'application.
 */
function longDescription(spec: AppSpec): string {
  const sections: string[] = [spec.tagline, '']

  const fonctions = spec.pages
    .flatMap((page) =>
      page.blocks.flatMap((block) => {
        if (block.type === 'features') return block.items.map((item) => `${item.title} : ${item.body}`)
        if (block.type === 'recordForm') return [block.title ?? 'Formulaire de saisie']
        if (block.type === 'recordList') return [block.title ?? 'Consultation des données']
        if (block.type === 'auth') return ['Espace membre avec compte personnel']
        if (block.type === 'assistant') return ['Assistant qui répond aux questions']
        return []
      }),
    )
    .slice(0, 12)

  if (fonctions.length > 0) {
    sections.push('Ce que vous pouvez faire :', '')
    sections.push(...fonctions.map((fonction) => `• ${fonction}`))
    sections.push('')
  }

  sections.push(
    `${spec.name} compte ${spec.pages.length} page${spec.pages.length > 1 ? 's' : ''} : ${spec.pages
      .map((page) => page.title)
      .join(', ')}.`,
  )

  return trim(sections.join('\n'), LIMITS.description)
}

export async function buildMobileKit(
  userId: string,
  projectId: string,
): Promise<MobileKitResult> {
  const plan = await getEffectivePlan(userId)
  if (!plan.allowMobilePrep) {
    throw new AppError(
      'PLAN_LIMIT',
      "La préparation pour mobile n'est pas incluse dans votre offre.",
    )
  }

  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      select: { name: true, slug: true, draftSpec: true, publishedAt: true },
    }),
  )
  if (project === null) throw notFound("Ce projet n'existe pas.")

  const parsed = appSpecSchema.safeParse(project.draftSpec)
  if (!parsed.success) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      "La description de cette application n'est pas relisible : le dossier ne peut pas être préparé.",
    )
  }
  const spec = parsed.data

  const now = new Date()
  const entries: ZipEntry[] = []

  // Les icônes carrées pour les fiches, et la série avec marge pour les masques d'Android.
  for (const size of ICON_SIZES) {
    const carre = await sharp(Buffer.from(iconSvg(spec, size, false))).png().toBuffer()
    entries.push({ path: `icones/icone-${size}.png`, content: Buffer.from(carre) })
  }
  for (const size of [512, 192] as const) {
    const masque = await sharp(Buffer.from(iconSvg(spec, size, true))).png().toBuffer()
    entries.push({ path: `icones/icone-adaptative-${size}.png`, content: Buffer.from(masque) })
  }

  const adresse = publicAppUrl(project.slug)

  entries.push({
    path: 'fiche-boutique.md',
    content: [
      `# Fiche boutique — ${spec.name}`,
      '',
      'Ces textes sont tirés de votre application. Relisez-les : ce sont eux que verront les',
      'personnes qui hésitent à installer.',
      '',
      `## Nom (${LIMITS.nom} caractères au plus)`,
      '',
      trim(spec.name, LIMITS.nom),
      '',
      `## Sous-titre (${LIMITS.sousTitre} caractères au plus)`,
      '',
      trim(spec.tagline, LIMITS.sousTitre),
      '',
      `## Résumé court (${LIMITS.resume} caractères au plus)`,
      '',
      trim(spec.tagline, LIMITS.resume),
      '',
      '## Description complète',
      '',
      longDescription(spec),
      '',
      '## Adresse de l’application',
      '',
      adresse,
      '',
      '## Confidentialité',
      '',
      'Les deux boutiques exigent une adresse de politique de confidentialité accessible',
      'publiquement. Celle d’Evoliia couvre les données traitées par la plateforme ; si votre',
      'application collecte autre chose, complétez-la.',
      '',
    ].join('\n'),
  })

  entries.push({
    path: 'A-FAIRE.md',
    content: [
      `# Publier ${spec.name} sur les boutiques`,
      '',
      '## Ce qui est prêt dans ce dossier',
      '',
      `- Les icônes aux ${ICON_SIZES.length} tailles exigées, plus la série adaptative d’Android`,
      '- Les textes de fiche, tirés de votre application',
      '- L’adresse publique de votre application',
      '',
      '## Ce qui reste de votre côté',
      '',
      project.publishedAt === null
        ? '- **Publier votre application.** Elle n’est pas encore en ligne, et une boutique demande une adresse qui fonctionne.'
        : '- Votre application est en ligne : cette condition est remplie.',
      '- **Un compte de développeur.** Apple facture un abonnement annuel, Google un droit',
      '  d’entrée unique. Les montants changent : vérifiez-les au moment de vous inscrire.',
      '- **Des captures d’écran** aux formats de chaque boutique. Ouvrez votre application sur',
      '  un téléphone et capturez les écrans qui montrent le mieux ce qu’elle fait.',
      '- **Chez Google, douze testeurs pendant quatorze jours** avant toute publication',
      '  ouverte. C’est la condition la plus longue à remplir : commencez par elle.',
      '- **La validation.** Les deux boutiques examinent chaque application et peuvent la',
      '  refuser. Nous ne pouvons rien promettre à leur place.',
      '',
      '## Faut-il vraiment passer par une boutique ?',
      '',
      'Votre application s’installe déjà sur l’écran d’accueil depuis le navigateur : icône,',
      'nom, ouverture en plein écran. Vos clients n’ont besoin de rien d’autre pour s’en servir',
      'tous les jours. Une boutique apporte la visibilité de son catalogue, au prix d’un',
      'abonnement, de délais, et d’une décision qui ne vous appartient pas.',
      '',
      'Beaucoup de projets gagnent à attendre d’avoir des utilisateurs avant de s’y engager.',
      '',
    ].join('\n'),
  })

  const archive = createZip(entries, now)
  logger.info('dossier mobile préparé', { projectId, files: entries.length })

  return {
    filename: `${project.slug}-mobile-${now.toISOString().slice(0, 10)}.zip`,
    archive,
    bytes: archive.length,
    files: entries.length,
  }
}
