import { z } from 'zod'
import { notFound } from '@/lib/errors'
import { requireOwnedProject, withRuntimeScope, withUserScope } from '@/server/db/scope'
import { generateSupportFaq } from '@/server/ai/operations'
import { logger } from '@/server/observability/logger'
import type { AppSpec } from '@/server/spec/schema'
import { assertLiaOpen } from './settings'

/**
 * La base de connaissances de Lia.
 *
 * C'est la seule chose que Lia a le droit de dire. Une entrée naît en brouillon quand
 * elle est générée, publiée quand le créateur l'a relue : le visiteur ne voit jamais un
 * brouillon, et la politique de la base le garantit indépendamment de ce code.
 *
 * La recherche est lexicale, volontairement. Une base de support compte quelques dizaines
 * d'entrées, écrites par une seule personne dans les mots de ses utilisateurs : les
 * mots-clés qu'elle choisit valent mieux qu'un rapprochement sémantique qu'elle ne
 * contrôlerait pas. Des vecteurs viendront si les bases grossissent.
 */

export const KNOWLEDGE_STATUSES = ['draft', 'published', 'disabled'] as const
export const FAQ_ESTIMATED_CREDITS = 3
export const MAX_ENTRIES = 200

export const entryInput = z.object({
  question: z.string().trim().min(3).max(200),
  answer: z.string().trim().min(3).max(1500),
  keywords: z.string().trim().max(300).default(''),
  status: z.enum(KNOWLEDGE_STATUSES).default('draft'),
})

export const entryUpdate = entryInput.partial().extend({ id: z.string().uuid() })

export type KnowledgeEntryView = {
  id: string
  kind: string
  question: string
  answer: string
  keywords: string
  status: (typeof KNOWLEDGE_STATUSES)[number]
  createdAt: string
  updatedAt: string
}

type Row = {
  id: string
  kind: string
  question: string
  answer: string
  keywords: string
  status: string
  createdAt: Date
  updatedAt: Date
}

function toView(row: Row): KnowledgeEntryView {
  return {
    id: row.id,
    kind: row.kind,
    question: row.question,
    answer: row.answer,
    keywords: row.keywords,
    status: row.status === 'published' ? 'published' : row.status === 'disabled' ? 'disabled' : 'draft',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listEntries(ownerId: string, projectId: string): Promise<KnowledgeEntryView[]> {
  const rows = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.supportKnowledgeEntry.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: MAX_ENTRIES,
    })
  })
  return rows.map(toView)
}

export async function createEntry(
  ownerId: string,
  projectId: string,
  input: z.infer<typeof entryInput>,
): Promise<KnowledgeEntryView> {
  await assertLiaOpen(ownerId)
  const row = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    const count = await tx.supportKnowledgeEntry.count({ where: { projectId } })
    if (count >= MAX_ENTRIES) {
      throw notFound(`La base est limitée à ${MAX_ENTRIES} entrées.`)
    }
    return tx.supportKnowledgeEntry.create({
      data: { userId: ownerId, projectId, kind: 'manual', ...input },
    })
  })
  return toView(row)
}

export async function updateEntry(
  ownerId: string,
  projectId: string,
  input: z.infer<typeof entryUpdate>,
): Promise<KnowledgeEntryView> {
  const { id, ...data } = input
  const row = await withUserScope(ownerId, async (tx) => {
    const found = await tx.supportKnowledgeEntry.findFirst({ where: { id, projectId, userId: ownerId }, select: { id: true } })
    if (found === null) throw notFound("Cette entrée n'existe pas.")
    return tx.supportKnowledgeEntry.update({ where: { id }, data })
  })
  return toView(row)
}

export async function deleteEntry(ownerId: string, projectId: string, id: string): Promise<void> {
  const deleted = await withUserScope(ownerId, (tx) =>
    tx.supportKnowledgeEntry.deleteMany({ where: { id, projectId, userId: ownerId } }),
  )
  if (deleted.count === 0) throw notFound("Cette entrée n'existe pas.")
}

/**
 * Ce que l'application dit d'elle-même, en texte, pour proposer des questions-réponses.
 * Pas de données d'utilisateurs, pas de réglages : le contenu visible, rien d'autre.
 */
export function specDigest(spec: AppSpec): string {
  const lines: string[] = [`Nom : ${spec.name}`, `Accroche : ${spec.tagline}`, `Description : ${spec.description}`]
  for (const page of spec.pages) {
    lines.push('', `Page « ${page.title} »${page.requiresAuth ? ' (réservée aux comptes)' : ''}`)
    for (const block of page.blocks) {
      if (block.type === 'hero') lines.push(`- ${block.title} — ${block.subtitle}`)
      else if (block.type === 'richText') lines.push(`- ${block.title ?? ''} ${block.body}`.trim())
      else if (block.type === 'features') for (const item of block.items) lines.push(`- Fonction : ${item.title} — ${item.body}`)
      else if (block.type === 'faq') for (const item of block.items) lines.push(`- Q : ${item.question} R : ${item.answer}`)
      else if (block.type === 'cta') lines.push(`- ${block.title} ${block.body ?? ''}`.trim())
      else if (block.type === 'pricing') lines.push(`- Offres : ${block.title ?? 'tarifs'}`)
      else if (block.type === 'recordForm') lines.push(`- Formulaire : ${block.title ?? ''}`.trim())
      else if (block.type === 'auth') lines.push('- Création de compte et connexion')
    }
  }
  if (spec.monetization.model !== 'free') {
    lines.push('', `Modèle : ${spec.monetization.model}, en ${spec.monetization.currency}`)
    for (const plan of spec.monetization.plans) {
      lines.push(`- Offre ${plan.name} : ${(plan.priceCents / 100).toFixed(2)} ${spec.monetization.currency} / ${plan.interval} — ${plan.features.join(', ')}`)
    }
    if (spec.monetization.note) lines.push(`- Note : ${spec.monetization.note}`)
  }
  return lines.join('\n').slice(0, 6000)
}

/** Génère des brouillons à partir du contenu. Le créateur relit avant de publier. */
export async function generateEntries(
  ownerId: string,
  projectId: string,
  locale: string,
): Promise<{ entries: KnowledgeEntryView[]; creditsSpent: number }> {
  await assertLiaOpen(ownerId)
  const project = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { draftSpec: true } })
  })
  const { parseAppSpec } = await import('@/server/spec/validate')
  const spec = parseAppSpec(project.draftSpec)
  const result = await generateSupportFaq(ownerId, projectId, specDigest(spec), locale)

  const rows = await withUserScope(ownerId, async (tx) => {
    const count = await tx.supportKnowledgeEntry.count({ where: { projectId } })
    const room = Math.max(0, MAX_ENTRIES - count)
    const data = result.value.entries.slice(0, room).map((entry) => ({
      userId: ownerId,
      projectId,
      kind: 'generated',
      question: entry.question,
      answer: entry.answer,
      keywords: entry.keywords.join(', '),
      status: 'draft',
    }))
    if (data.length > 0) await tx.supportKnowledgeEntry.createMany({ data })
    return tx.supportKnowledgeEntry.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: MAX_ENTRIES,
    })
  })
  logger.info('lia : questions-réponses générées', { userId: ownerId, projectId, count: result.value.entries.length })
  return { entries: rows.map(toView), creditsSpent: result.creditsSpent }
}

// ── Recherche ────────────────────────────────────────────────────────────────

const STOP = new Set([
  'pour', 'des', 'les', 'une', 'un', 'de', 'du', 'la', 'le', 'et', 'ou', 'en', 'au', 'aux', 'sur',
  'avec', 'sans', 'par', 'qui', 'que', 'quoi', 'est', 'mon', 'ma', 'mes', 'votre', 'vos', 'ce',
  'cette', 'ces', 'je', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'comment', 'puis', 'peut',
  'the', 'and', 'for', 'with', 'how', 'can', 'what', 'where', 'this', 'that', 'you', 'your',
  'bonjour', 'merci', 'svp',
])

export function tokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !STOP.has(word))
        .map((word) => word.replace(/(s|x)$/, '')),
    ),
  ]
}

export type Rankable = { id: string; question: string; answer: string; keywords: string }

/**
 * Classe les entrées par proximité avec une question. Un mot-clé choisi par le créateur
 * pèse plus qu'un mot de la réponse ; un mot de la question de l'entrée pèse entre les deux.
 */
export function rankEntries<T extends Rankable>(question: string, entries: T[], limit = 4): Array<T & { score: number }> {
  const asked = tokens(question)
  if (asked.length === 0) return []
  return entries
    .map((entry) => {
      const keys = new Set(tokens(entry.keywords))
      const qs = new Set(tokens(entry.question))
      const as = new Set(tokens(entry.answer))
      let score = 0
      for (const word of asked) {
        if (keys.has(word)) score += 3
        else if (qs.has(word)) score += 2
        else if (as.has(word)) score += 1
      }
      return { ...entry, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Les entrées publiées les plus proches d'une question, vues depuis l'application servie. */
export async function retrieve(projectId: string, question: string, limit = 4): Promise<Array<Rankable & { score: number }>> {
  const rows = await withRuntimeScope(projectId, (tx) =>
    tx.supportKnowledgeEntry.findMany({
      where: { projectId, status: 'published' },
      select: { id: true, question: true, answer: true, keywords: true },
      take: MAX_ENTRIES,
    }),
  )
  return rankEntries(question, rows, limit)
}
