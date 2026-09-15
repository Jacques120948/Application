import { withUserScope } from '@/server/db/scope'
import { appSpecSchema } from '@/server/spec/schema'
import { launchKitSchema } from '@/lib/marketing'
import { ANGLE_FAMILY_LABEL, DAY_LABEL, FORMAT_LABEL } from '@/lib/marketing'
import type { AgentId } from './catalog'
import { publicAppUrl } from '@/lib/apps-domain'

/**
 * Ce que chaque spécialiste a le droit de lire.
 *
 * Tout ce qui sort d'ici est un fait constaté dans la base du projet : un titre de page
 * existe ou n'existe pas, une visite a eu lieu ou non. Il n'y a pas de « probablement »,
 * pas d'estimation, pas de moyenne de marché. Quand la donnée manque, c'est écrit en
 * toutes lettres, et la consigne du spécialiste est de le dire plutôt que de combler.
 *
 * C'est aussi une mesure d'économie. Donner les trois contextes à chacun tripleraient le
 * coût de chaque question pour une réponse plus floue.
 */

const WINDOW_DAYS = 30

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export type ProjectHeader = {
  id: string
  name: string
  slug: string
  published: boolean
  publicUrl: string | null
}

export async function readProjectHeader(
  userId: string,
  projectId: string,
): Promise<ProjectHeader | null> {
  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      select: { id: true, name: true, slug: true, publishedAt: true },
    }),
  )
  if (project === null) return null
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    published: project.publishedAt !== null,
    publicUrl:
      project.publishedAt === null ? null : publicAppUrl(project.slug),
  }
}

/** Ce que Tom sait : le kit préparé, son état, et ce qui a déjà servi. */
async function socialFacts(userId: string, projectId: string): Promise<string> {
  const kit = await withUserScope(userId, (tx) =>
    tx.marketingKit.findFirst({
      where: { userId, projectId },
      orderBy: { createdAt: 'desc' },
    }),
  )
  if (kit === null) {
    return "Aucun kit de lancement n'a encore été préparé pour ce projet. Il n'y a donc ni angle, ni idée, ni semaine à commenter."
  }

  const parsed = launchKitSchema.safeParse(kit.content)
  if (!parsed.success) return "Le kit de lancement existe mais n'est pas relisible."

  const content = parsed.data
  const anglesUtilises = new Set(content.week.map((post) => post.angleKey))
  const anglesDisponibles = Object.keys(ANGLE_FAMILY_LABEL) as Array<
    keyof typeof ANGLE_FAMILY_LABEL
  >

  return [
    `Kit préparé le ${kit.createdAt.toISOString().slice(0, 10)}.`,
    kit.approvedAt === null ? 'Il n’a pas encore été approuvé.' : 'Il a été approuvé.',
    kit.sentToSocialAt === null
      ? 'Il n’a pas été déposé dans un espace de publication.'
      : `Il a été déposé le ${kit.sentToSocialAt.toISOString().slice(0, 10)}.`,
    `Proposition de valeur retenue : ${content.valueProposition}`,
    `Bénéfices : ${content.benefits.join(' / ')}`,
    `Angles du kit : ${content.angles.map((angle) => `${ANGLE_FAMILY_LABEL[angle.key]} — ${angle.title}`).join(' ; ')}`,
    `Semaine préparée : ${content.week
      .map(
        (post) =>
          `${DAY_LABEL[post.day] ?? '?'} ${post.time} (${FORMAT_LABEL[post.format]}, ${ANGLE_FAMILY_LABEL[post.angleKey]}) : ${post.caption.slice(0, 160)}`,
      )
      .join(' | ')}`,
    `Angles déjà utilisés dans la semaine : ${[...anglesUtilises]
      .map((key) => ANGLE_FAMILY_LABEL[key])
      .join(', ')}.`,
    `Angles encore inutilisés : ${anglesDisponibles
      .filter((key) => !anglesUtilises.has(key))
      .map((key) => ANGLE_FAMILY_LABEL[key])
      .join(', ')}.`,
  ].join('\n')
}

/** Ce que Noah sait : les pages réellement publiées, leurs titres, leurs adresses. */
async function seoFacts(userId: string, projectId: string): Promise<string> {
  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      select: { draftSpec: true, publishedAt: true, slug: true, idea: true },
    }),
  )
  if (project === null) return 'Projet introuvable.'

  const spec = appSpecSchema.safeParse(project.draftSpec)
  if (!spec.success) return "La description de l'application n'est pas relisible."

  const base = publicAppUrl(project.slug)

  const pages = spec.data.pages.map((page) => {
    // Les blocs sont une union discriminée : chacun n'a pas les mêmes champs, et lire un
    // champ absent donnerait un intertitre fantôme dans le diagnostic.
    const titres: string[] = []
    let caracteres = 0
    for (const block of page.blocks) {
      if (block.type === 'hero') {
        titres.push(block.title)
        caracteres += block.subtitle.length
      } else if (block.type === 'richText') {
        if (block.title !== undefined) titres.push(block.title)
        caracteres += block.body.length
      } else if (block.type === 'features') {
        if (block.title !== undefined) titres.push(block.title)
        for (const item of block.items) caracteres += item.title.length + item.body.length
      } else if (block.type === 'faq') {
        if (block.title !== undefined) titres.push(block.title)
        for (const item of block.items) caracteres += item.question.length + item.answer.length
      } else if (block.type === 'cta') {
        titres.push(block.title)
        caracteres += block.body?.length ?? 0
      }
    }
    return [
      `Page « ${page.title} » — adresse ${base}/${page.path}`,
      `  type des blocs : ${page.blocks.map((block) => block.type).join(', ')}`,
      titres.length === 0
        ? '  aucun titre de section'
        : `  titres de section : ${titres.slice(0, 8).join(' | ')}`,
      `  longueur du texte rédigé : ${caracteres} caractères`,
    ].join('\n')
  })

  return [
    project.publishedAt === null
      ? "L'application n'est pas encore publiée : rien n'est indexable pour l'instant."
      : `L'application est publiée depuis le ${project.publishedAt.toISOString().slice(0, 10)}.`,
    `Nom : ${spec.data.name}`,
    `Accroche : ${spec.data.tagline}`,
    `Idée de départ décrite par le créateur : ${project.idea.slice(0, 600)}`,
    `Nombre de pages : ${spec.data.pages.length}`,
    ...pages,
  ].join('\n')
}

/** Ce que Mila sait : les chiffres réellement enregistrés, sur trente jours. */
async function analyticsFacts(userId: string, projectId: string): Promise<string> {
  const from = since(WINDOW_DAYS)

  const [parPage, parType, inscriptions, donnees, publication] = await withUserScope(
    userId,
    async (tx) =>
      Promise.all([
        tx.appEvent.groupBy({
          by: ['path'],
          where: { projectId, type: 'view', createdAt: { gte: from } },
          _count: { _all: true },
        }),
        tx.appEvent.groupBy({
          by: ['type'],
          where: { projectId, createdAt: { gte: from } },
          _count: { _all: true },
        }),
        tx.appEndUser.count({ where: { projectId, createdAt: { gte: from } } }),
        tx.appRecord.count({ where: { projectId, createdAt: { gte: from } } }),
        tx.project.findFirst({ where: { id: projectId }, select: { publishedAt: true } }),
      ]),
  )

  const vues = parType.find((row) => row.type === 'view')?._count._all ?? 0

  if (publication?.publishedAt == null) {
    return "L'application n'est pas encore publiée. Aucun chiffre de fréquentation n'existe, et il n'y a rien à interpréter tant qu'elle n'est pas en ligne."
  }
  if (vues === 0) {
    return [
      `L'application est en ligne depuis le ${publication.publishedAt.toISOString().slice(0, 10)}.`,
      `Sur les ${WINDOW_DAYS} derniers jours : aucune visite enregistrée.`,
      "Il n'y a donc aucun chiffre à interpréter. La question utile est celle de la mise en visibilité, pas celle de la conversion.",
    ].join('\n')
  }

  const classement = [...parPage]
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 10)
    .map((row) => `  ${row.path ?? '(inconnue)'} : ${row._count._all} vues`)

  return [
    `Période observée : les ${WINDOW_DAYS} derniers jours.`,
    `En ligne depuis le ${publication.publishedAt.toISOString().slice(0, 10)}.`,
    `Visites : ${vues}`,
    `Inscriptions de visiteurs : ${inscriptions}`,
    `Enregistrements créés par les visiteurs : ${donnees}`,
    ...parType
      .filter((row) => row.type !== 'view')
      .map((row) => `Événements « ${row.type} » : ${row._count._all}`),
    'Pages les plus vues :',
    ...classement,
  ].join('\n')
}

/**
 * Dernières conclusions des collègues.
 *
 * C'est tout l'effet de la fonction « équipe ». Sans elle, chaque spécialiste raisonne
 * seul ; avec elle, Tom sait ce que Mila a constaté la veille. On ne transmet qu'une phrase
 * par métier : une conversation entière noierait la question posée et coûterait cher.
 */
export async function teamMemory(
  userId: string,
  projectId: string,
  exclude: AgentId,
): Promise<string | null> {
  const notes = await withUserScope(userId, (tx) =>
    tx.agentNote.findMany({
      where: { projectId, agent: { not: exclude }, takeaway: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { agent: true, takeaway: true, createdAt: true },
    }),
  )
  if (notes.length === 0) return null

  const dernieres = new Map<string, string>()
  for (const note of notes) {
    if (note.takeaway !== null && !dernieres.has(note.agent)) {
      dernieres.set(note.agent, note.takeaway)
    }
  }
  if (dernieres.size === 0) return null

  return [...dernieres.entries()]
    .map(([agent, takeaway]) => `${agent} : ${takeaway}`)
    .join('\n')
}

/** Faits du projet, dans le périmètre du spécialiste interrogé. */
export async function readFacts(
  agent: AgentId,
  userId: string,
  projectId: string,
): Promise<string> {
  if (agent === 'social') return socialFacts(userId, projectId)
  if (agent === 'seo') return seoFacts(userId, projectId)
  return analyticsFacts(userId, projectId)
}

