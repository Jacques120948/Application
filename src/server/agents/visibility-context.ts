import { listAudits, readPlan } from '@/server/audit/plan'
import { JOURS_LUS, recherchesPourArticle } from '@/server/audit/recherches'
import { withUserScope } from '@/server/db/scope'
import type { VisibilityAgentId } from './visibility'

/**
 * Ce que chaque spécialiste de la visibilité a le droit de lire.
 *
 * Trois raisons, et la première n'est pas technique.
 *
 * **Un spécialiste qui voit tout n'est pas un spécialiste.** C'est un assistant généraliste
 * avec un prénom, et cela se sent au bout de trois échanges : il répond à côté, il mélange
 * les sujets, il donne un avis sur ce qu'il n'a pas regardé. Néo voit les constats de
 * référencement et les balises des pages ; Gia voit ce qu'une machine comprend ; Milo voit
 * le texte. Chacun répond mieux de moins.
 *
 * **Tout ce qui sort d'ici est mesuré.** Un titre existe ou n'existe pas, une note vaut 69
 * ou elle n'est pas calculée. Il n'y a ni estimation, ni moyenne de marché, ni
 * « probablement ». Quand la donnée manque, c'est écrit en toutes lettres, et la consigne du
 * spécialiste est de le dire plutôt que de combler.
 *
 * **Un contexte plus large coûte plus cher à chaque question, pour une réponse moins nette.**
 * Donner les quatre périmètres à chacun multiplierait la facture par quatre sans rien
 * améliorer.
 *
 * Les chiffres de recherche suivent la même règle et ne vont donc qu'à deux d'entre eux.
 * Néo, parce qu'une position est un fait de référencement et que c'est lui qui réécrit les
 * balises des pages concernées. Milo, parce que c'est lui qui écrit, et qu'écrire sur ce que
 * les gens tapent vaut mieux qu'écrire sur ce que le site ne couvre pas. Léa dit par quoi
 * commencer à partir des constats, Gia regarde ce qu'une machine comprend : ni l'une ni
 * l'autre n'en ferait quelque chose, et le contexte se paie à chaque question.
 */

/** Au-delà, le contexte coûte plus qu'il n'éclaire. */
const CONSTATS_MAX = 10
const PAGES_MAX = 12
const ANALYSES_MAX = 6

function ligneConstat(ligne: {
  label: string
  severity: string
  affected: number
  examined: number
  scope: string
  state: string
}): string {
  const etendue = ligne.scope === 'site' ? 'tout le site' : `${ligne.affected}/${ligne.examined} pages`
  const etat =
    ligne.state === 'done'
      ? ' [marqué corrigé]'
      : ligne.state === 'doing'
        ? ' [en cours]'
        : ligne.state === 'ignored'
          ? ' [ignoré]'
          : ''
  return `- ${ligne.label} (${ligne.severity}, ${etendue})${etat}`
}

/** L'en-tête commun : de quel site on parle, et où il en est. */
async function enTete(userId: string, siteId: string): Promise<string[]> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true, label: true, about: true },
    }),
  )
  if (site === null) return ['Site introuvable.']

  const analyses = await listAudits(userId, siteId, ANALYSES_MAX)
  const derniere = analyses[0]

  const lignes = [
    `Site : ${site.label} (${site.host}).`,
    site.about.trim() === ''
      ? "Le créateur n'a rien écrit sur son activité. N'en déduis rien."
      : `Ce que le créateur dit de son activité : ${site.about}`,
  ]
  if (derniere === undefined) {
    lignes.push("Aucune analyse terminée : tu ne disposes d'aucun constat mesuré.")
    return lignes
  }
  lignes.push(
    `Dernière analyse : ${derniere.pagesCrawled} pages lues. Note de référencement ${derniere.seoScore ?? 'non calculée'}/100, note « moteurs IA » ${derniere.geoScore ?? 'non calculée'}/100.`,
  )
  if (analyses.length > 1) {
    lignes.push(
      `Évolution (de la plus ancienne à la plus récente) : ${[...analyses]
        .reverse()
        .map((analyse) => `${analyse.seoScore ?? '?'}/${analyse.geoScore ?? '?'}`)
        .join(' → ')} (référencement/moteurs IA).`,
    )
  }
  return lignes
}

/** Les constats du plan, filtrés par moteur. Léa les voit tous. */
async function constats(
  userId: string,
  siteId: string,
  moteur: 'seo' | 'geo' | null,
): Promise<string[]> {
  const plan = await readPlan(userId, siteId)
  if (plan === null || plan.lignes.length === 0) {
    return ['Aucun point à corriger dans ce périmètre.']
  }
  const retenues = plan.lignes
    .filter((ligne) => moteur === null || ligne.engine === moteur)
    .slice(0, CONSTATS_MAX)
  if (retenues.length === 0) return ['Aucun point à corriger dans ce périmètre.']
  return ['Constats mesurés, du plus coûteux au moins :', ...retenues.map(ligneConstat)]
}

/** Un échantillon de pages, avec ce que chaque spécialiste a besoin d'en voir. */
async function pages(
  userId: string,
  siteId: string,
  quoi: 'balises' | 'machine' | 'texte',
): Promise<string[]> {
  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    }),
  )
  if (audit === null) return []

  const relevees = await withUserScope(userId, (tx) =>
    tx.auditPage.findMany({
      where: { auditId: audit.id },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
      take: PAGES_MAX,
      select: { path: true, title: true, description: true, wordCount: true, signals: true },
    }),
  )
  if (relevees.length === 0) return []

  type Releve = {
    h1?: string[]
    intro?: string
    schemaTypes?: string[]
    headings?: { level: number; text: string }[]
    lists?: number
    tables?: number
    author?: string
  }

  const decrire = (page: (typeof relevees)[number]): string => {
    const signaux = (page.signals as unknown as Releve | null) ?? {}
    if (quoi === 'balises') {
      return `- ${page.path} | title: ${page.title || '(absent)'} | description: ${page.description || '(absente)'} | h1: ${signaux.h1?.[0] ?? '(absent)'}`
    }
    if (quoi === 'machine') {
      const questions = (signaux.headings ?? []).filter(
        (titre) => titre.level >= 2 && titre.text.trim().endsWith('?'),
      ).length
      return `- ${page.path} | données structurées: ${(signaux.schemaTypes ?? []).join(', ') || '(aucune)'} | intertitres-questions: ${questions} | listes: ${signaux.lists ?? 0} | tableaux: ${signaux.tables ?? 0} | auteur: ${signaux.author || '(absent)'}`
    }
    return `- ${page.path} | ${page.wordCount} mots | h1: ${signaux.h1?.[0] ?? '(absent)'} | début: ${(signaux.intro ?? '').slice(0, 160) || '(aucun paragraphe substantiel)'}`
  }

  return [`Pages relevées (${relevees.length} sur les plus proches de l'accueil) :`, ...relevees.map(decrire)]
}

/**
 * Ce que les gens tapent réellement, quand Search Console est relié.
 *
 * Rend une liste vide sans connexion, sans propriété correspondante, ou si Google tarde :
 * la lecture est bornée dans le temps et ne fait jamais échouer une question. Quand elle
 * ne rend rien, le spécialiste reçoit une phrase qui le dit — parce qu'un silence se comble
 * par une estimation, et qu'une estimation est exactement ce que ce produit refuse.
 */
async function recherches(userId: string, siteId: string): Promise<string[]> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { origin: true },
    }),
  )
  if (site === null) return []

  const lignes = await recherchesPourArticle(userId, site.origin)
  if (lignes.length === 0) {
    return [
      "Aucune donnée de recherche n'est disponible pour ce site : ne parle ni de volume de recherche, ni de position dans Google, ni de concurrence. Tu ne les connais pas.",
    ]
  }
  return [
    `Recherches réelles relevées par Google sur les ${JOURS_LUS} derniers jours (les plus proches de la première page d'abord) :`,
    ...lignes.map(
      (ligne) =>
        `- « ${ligne.requete} » | ${ligne.impressions} affichages | ${ligne.clics} clics | position moyenne ${ligne.position}`,
    ),
  ]
}

/**
 * Les faits d'un spécialiste, prêts à être mis dans son contexte.
 *
 * Rien n'est calculé ici : tout vient des contrôles, qui sont du code. Ce module ne fait que
 * choisir ce que chacun a le droit de voir, et le mettre en phrases.
 */
export async function readSiteFacts(
  agent: VisibilityAgentId,
  userId: string,
  siteId: string,
): Promise<string> {
  const base = await enTete(userId, siteId)

  if (agent === 'audit') {
    // Léa voit tout, parce que son métier est de dire par quoi commencer. Elle ne voit
    // pas le détail des pages : ce n'est pas elle qui rédige.
    return [...base, ...(await constats(userId, siteId, null))].join('\n')
  }
  if (agent === 'seo') {
    return [
      ...base,
      ...(await constats(userId, siteId, 'seo')),
      ...(await pages(userId, siteId, 'balises')),
      ...(await recherches(userId, siteId)),
    ].join('\n')
  }
  if (agent === 'geo') {
    return [
      ...base,
      ...(await constats(userId, siteId, 'geo')),
      ...(await pages(userId, siteId, 'machine')),
    ].join('\n')
  }
  /*
   * Milo écrit. Il voit les deux catalogues — un texte sert au référencement comme aux
   * assistants — mais il voit surtout le texte lui-même, ce que les autres n'ont pas.
   */
  return [
    ...base,
    ...(await constats(userId, siteId, null)),
    ...(await pages(userId, siteId, 'texte')),
    ...(await recherches(userId, siteId)),
  ].join('\n')
}

/**
 * Ce que les collègues ont retenu, pour que l'équipe en soit une.
 *
 * Une phrase par échange, celle que chacun a jugée utile aux autres. Sans cela, quatre
 * spécialistes qui ne se parlent pas répètent les mêmes questions à la personne, et c'est
 * elle qui fait le lien — c'est-à-dire le travail qu'on lui promet d'éviter.
 */
export async function siteMemory(
  userId: string,
  siteId: string,
  sauf: VisibilityAgentId,
): Promise<string | null> {
  const notes = await withUserScope(userId, (tx) =>
    tx.visibilityNote.findMany({
      where: { siteId, userId, agent: { not: sauf }, takeaway: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { agent: true, takeaway: true },
    }),
  )
  if (notes.length === 0) return null
  return notes.map((note) => `- ${note.agent} : ${note.takeaway}`).join('\n')
}
