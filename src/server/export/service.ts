import { AppError, notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { getEffectivePlan } from '@/server/billing/plans'
import { appSpecSchema } from '@/server/spec/schema'
import { logger } from '@/server/observability/logger'
import { createZip, type ZipEntry } from './zip'
import { fileNameFor, renderPage, renderStylesheet } from './site'

/**
 * Export d'un projet.
 *
 * Ce que le créateur récupère est un dossier qui s'ouvre : ses pages en HTML, sa feuille de
 * style, ses images, ses données, et la description complète de son application. Il double-
 * clique sur `index.html` et son site est là, sans rien installer.
 *
 * Trois décisions à assumer.
 *
 * **Ce n'est pas le code d'Evoliia.** Exporter le moteur donnerait au créateur des milliers
 * de lignes qui ne fonctionnent pas sans base ni clés, et le priverait de ce qu'il voulait :
 * un site à lui, qu'il peut héberger n'importe où.
 *
 * **Ce qui a besoin d'un serveur est annoncé, jamais simulé.** Un formulaire exporté
 * n'enregistre rien ; le dire est la seule honnêteté possible.
 *
 * **Rien n'est facturé en crédits.** L'export n'appelle aucun modèle : il assemble des
 * fichiers déjà écrits. Il est borné par l'offre, pas par le solde.
 */

/** Nombre maximal d'enregistrements repris dans les fichiers de données. */
const MAX_RECORDS = 5_000

export type ExportResult = {
  filename: string
  archive: Buffer
  bytes: number
  files: number
}

/** Nom de fichier d'archive : le créateur en aura plusieurs, la date les distingue. */
function archiveName(slug: string, now: Date): string {
  return `${slug}-${now.toISOString().slice(0, 10)}.zip`
}

/**
 * Échappe une valeur pour un fichier CSV.
 *
 * Le guillemet doublé et l'encadrement systématique évitent le piège classique : une
 * réponse contenant une virgule ou un retour à la ligne décalerait toutes les colonnes
 * suivantes, sans que rien ne signale l'erreur.
 */
function csvCell(value: unknown): string {
  const texte =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  return `"${texte.replace(/"/g, '""')}"`
}

export async function exportProject(userId: string, projectId: string): Promise<ExportResult> {
  const plan = await getEffectivePlan(userId)
  if (!plan.allowExport) {
    throw new AppError(
      'PLAN_LIMIT',
      "L'export n'est pas inclus dans votre offre.",
    )
  }

  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        idea: true,
        draftSpec: true,
        publishedAt: true,
        createdAt: true,
      },
    }),
  )
  if (project === null) throw notFound("Ce projet n'existe pas.")

  const spec = appSpecSchema.safeParse(project.draftSpec)
  if (!spec.success) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      "La description de cette application n'est pas relisible : l'export est impossible.",
    )
  }

  const [medias, records] = await withUserScope(userId, async (tx) =>
    Promise.all([
      tx.mediaAsset.findMany({
        where: { projectId },
        select: { id: true, filename: true, data: true },
      }),
      tx.appRecord.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        take: MAX_RECORDS,
        select: { id: true, modelId: true, data: true, createdAt: true },
      }),
    ]),
  )

  const now = new Date()
  const entries: ZipEntry[] = []

  // Les images gardent un nom stable tiré de leur identifiant : deux fichiers d'origine
  // homonymes ne doivent pas s'écraser l'un l'autre dans l'archive.
  const cheminsImages = new Map<string, string>()
  for (const media of medias) {
    const chemin = `images/${media.id}.webp`
    cheminsImages.set(media.id, chemin)
    entries.push({ path: chemin, content: Buffer.from(media.data) })
  }

  for (const page of spec.data.pages) {
    entries.push({
      path: fileNameFor(page),
      content: renderPage(spec.data, page, cheminsImages),
    })
  }
  entries.push({ path: 'styles.css', content: renderStylesheet(spec.data) })

  // La description complète de l'application. C'est elle qui permettrait de la reconstruire
  // ailleurs, ou de la réimporter un jour.
  entries.push({
    path: 'application.json',
    content: JSON.stringify(spec.data, null, 2),
  })

  // Les données saisies par les visiteurs, un fichier par modèle, lisible dans un tableur.
  const parModele = new Map<string, typeof records>()
  for (const record of records) {
    const liste = parModele.get(record.modelId) ?? []
    liste.push(record)
    parModele.set(record.modelId, liste)
  }
  for (const [modelId, lignes] of parModele) {
    const colonnes = [
      ...new Set(
        lignes.flatMap((ligne) =>
          typeof ligne.data === 'object' && ligne.data !== null && !Array.isArray(ligne.data)
            ? Object.keys(ligne.data as Record<string, unknown>)
            : [],
        ),
      ),
    ]
    const entete = ['id', 'cree_le', ...colonnes].map(csvCell).join(',')
    const corps = lignes.map((ligne) => {
      const donnees =
        typeof ligne.data === 'object' && ligne.data !== null && !Array.isArray(ligne.data)
          ? (ligne.data as Record<string, unknown>)
          : {}
      return [
        csvCell(ligne.id),
        csvCell(ligne.createdAt.toISOString()),
        ...colonnes.map((colonne) => csvCell(donnees[colonne])),
      ].join(',')
    })
    entries.push({ path: `donnees/${modelId}.csv`, content: [entete, ...corps].join('\n') })
  }

  const dynamiques = spec.data.pages.flatMap((page) =>
    page.blocks
      .filter((block) =>
        ['recordForm', 'recordList', 'auth', 'assistant', 'pricing'].includes(block.type),
      )
      .map((block) => `${page.title} → ${block.type}`),
  )

  entries.push({
    path: 'LISEZMOI.md',
    content: [
      `# ${project.name}`,
      '',
      `Export réalisé le ${now.toISOString().slice(0, 10)} depuis Evoliia.`,
      '',
      '## Ouvrir votre site',
      '',
      'Double-cliquez sur `index.html`. Tout s’affiche depuis ce dossier, sans rien installer.',
      'Pour le mettre en ligne, déposez le dossier entier chez n’importe quel hébergeur de',
      'fichiers : il n’a besoin d’aucun serveur particulier.',
      '',
      '## Ce que contient le dossier',
      '',
      `- ${spec.data.pages.length} page${spec.data.pages.length > 1 ? 's' : ''} en HTML, une par fichier`,
      '- `styles.css` : toutes les couleurs et les mises en forme, modifiables directement',
      medias.length === 0
        ? '- aucune image : vous n’en aviez pas téléversé'
        : `- \`images/\` : vos ${medias.length} image${medias.length > 1 ? 's' : ''}`,
      parModele.size === 0
        ? '- aucune donnée enregistrée par vos visiteurs'
        : `- \`donnees/\` : ce que vos visiteurs ont enregistré, au format tableur`,
      '- `application.json` : la description complète de votre application',
      '',
      '## Ce qui ne fonctionne pas hors ligne',
      '',
      dynamiques.length === 0
        ? 'Rien. Toutes vos pages fonctionnent telles quelles.'
        : [
            'Certaines parties avaient besoin d’un serveur pour fonctionner : enregistrer des',
            'réponses, vérifier un mot de passe, appeler un assistant. Dans l’export, elles',
            'laissent un encadré qui explique ce qu’elles faisaient, plutôt qu’un formulaire',
            'qui n’irait nulle part.',
            '',
            ...dynamiques.map((entree) => `- ${entree}`),
            '',
            'Votre application reste en ligne chez Evoliia avec toutes ces fonctions.',
          ].join('\n'),
      '',
      '## Vos données vous appartiennent',
      '',
      'Cet export est complet et sans condition. Vous pouvez l’héberger où vous voulez, le',
      'modifier, ou le confier à quelqu’un d’autre.',
      '',
    ].join('\n'),
  })

  const archive = createZip(entries, now)
  logger.info('projet exporté', {
    projectId,
    files: entries.length,
    bytes: archive.length,
  })

  return {
    filename: archiveName(project.slug, now),
    archive,
    bytes: archive.length,
    files: entries.length,
  }
}
