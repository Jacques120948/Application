import type { PrismaClient } from '@prisma/client'
import { DEFAULT_PLANS } from './plans'

/**
 * Ouverture du Radar et de Lia dans les offres existantes.
 *
 * Le démarrage ne réécrit jamais une offre déjà en base : elle appartient à l'exploitant.
 * Cette ouverture est donc un geste à part, fait **une seule fois** : on ajoute les deux
 * fonctions selon la répartition par défaut, et on ne pose les quotas que là où ils sont
 * encore à leur valeur d'origine (1 / 0 / 0). Un quota déjà réglé depuis le back-office
 * est conservé. Relançable sans effet de bord.
 */

/** Marque, en base, que l'ouverture a été faite : le démarrage ne la refera pas. */
export const ACTIVATION_KEY = 'offres.radar-et-lia.ouvertes'

export async function activerRadarEtLia(prisma: PrismaClient): Promise<string[]> {
  const lignes: string[] = []
  for (const defaults of DEFAULT_PLANS) {
    const plan = await prisma.plan.findUnique({ where: { id: defaults.id } })
    if (plan === null) continue
    const wanted = defaults.features.filter((f) => f === 'radar' || f === 'lia_support')
    const features = [...new Set([...plan.features, ...wanted])]
    const untouched =
      plan.radarRunsPerMonth === 1 && plan.liaAnswersPerMonth === 0 && plan.liaConversationsPerMonth === 0
    const updated = await prisma.plan.update({
      where: { id: plan.id },
      data: {
        features,
        ...(untouched
          ? {
              radarRunsPerMonth: defaults.radarRunsPerMonth,
              liaAnswersPerMonth: defaults.liaAnswersPerMonth,
              liaConversationsPerMonth: defaults.liaConversationsPerMonth,
            }
          : {}),
      },
    })
    lignes.push(
      `${plan.name} : ${wanted.join(', ') || 'rien'} — Radar ${updated.radarRunsPerMonth}/mois, Lia ${updated.liaAnswersPerMonth} réponses, ${updated.liaConversationsPerMonth} conversations${untouched ? '' : ' (quotas déjà réglés, conservés)'}`,
    )
  }
  return lignes
}

/** Fait l'ouverture si elle n'a jamais été faite sur cette installation. */
export async function activerRadarEtLiaUneFois(prisma: PrismaClient): Promise<string[] | null> {
  const done = await prisma.siteSetting.findUnique({ where: { key: ACTIVATION_KEY } })
  if (done !== null) return null
  const lignes = await activerRadarEtLia(prisma)
  await prisma.siteSetting.upsert({
    where: { key: ACTIVATION_KEY },
    update: { value: new Date().toISOString() },
    create: { key: ACTIVATION_KEY, value: new Date().toISOString() },
  })
  return lignes
}

/**
 * Ouverture des chiffres de recherche dans les offres existantes.
 *
 * Même geste, même raison, et il faut le refaire à chaque fonction : le démarrage ne
 * réécrit jamais la colonne `features` d'une offre déjà en base, parce qu'elle appartient à
 * l'exploitant et qu'il la règle depuis le back-office. Sans cette ouverture, une fonction
 * ajoutée au catalogue n'atteindrait jamais une installation en service — elle ne servirait
 * qu'aux offres créées après elle.
 *
 * On ajoute, on ne retire rien, et on suit la répartition par défaut : les offres qui ne
 * l'accordent pas par défaut ne la reçoivent pas. Relançable sans effet de bord.
 */
export const SEARCH_CONSOLE_KEY = 'offres.search-console.ouverte'

export async function ouvrirSearchConsole(prisma: PrismaClient): Promise<string[]> {
  const lignes: string[] = []
  for (const defaults of DEFAULT_PLANS) {
    const plan = await prisma.plan.findUnique({ where: { id: defaults.id } })
    if (plan === null) continue
    if (!defaults.features.includes('search_console')) continue
    if (plan.features.includes('search_console')) continue

    await prisma.plan.update({
      where: { id: plan.id },
      data: { features: [...plan.features, 'search_console'] },
    })
    lignes.push(`${plan.name} : chiffres de recherche ouverts`)
  }
  return lignes
}

/** Fait l'ouverture si elle n'a jamais été faite sur cette installation. */
export async function ouvrirSearchConsoleUneFois(prisma: PrismaClient): Promise<string[] | null> {
  const done = await prisma.siteSetting.findUnique({ where: { key: SEARCH_CONSOLE_KEY } })
  if (done !== null) return null
  const lignes = await ouvrirSearchConsole(prisma)
  await prisma.siteSetting.upsert({
    where: { key: SEARCH_CONSOLE_KEY },
    update: { value: new Date().toISOString() },
    create: { key: SEARCH_CONSOLE_KEY, value: new Date().toISOString() },
  })
  return lignes
}

/**
 * Ouverture de Cleo et d'Oria dans les offres existantes.
 *
 * Même geste que pour les chiffres de recherche, et pour la même raison : une fonction
 * ajoutée au catalogue n'atteint jamais une offre déjà en base, parce que la colonne
 * `features` appartient à l'exploitant. Sans ce geste, les deux agents s'affichent mais
 * refusent de répondre — leur écran est ouvert, leur conversation non.
 *
 * On ajoute, on ne retire rien, et on suit la répartition par défaut. Relançable sans
 * effet de bord. Ce n'est jamais fait au démarrage : c'est l'amorçage qui le propose, et
 * l'exploitant qui le lance.
 */
export const CLEO_ORIA_KEY = 'offres.cleo-oria.ouvertes'

const AGENTS_A_OUVRIR = ['visibility_cro_agent', 'oria_agent'] as const

export async function ouvrirCleoEtOria(prisma: PrismaClient): Promise<string[]> {
  const lignes: string[] = []
  for (const defaults of DEFAULT_PLANS) {
    const plan = await prisma.plan.findUnique({ where: { id: defaults.id } })
    if (plan === null) continue
    const manquants = AGENTS_A_OUVRIR.filter(
      (id) => defaults.features.includes(id) && !plan.features.includes(id),
    )
    if (manquants.length === 0) continue
    await prisma.plan.update({
      where: { id: plan.id },
      data: { features: [...plan.features, ...manquants] },
    })
    lignes.push(`${plan.name} : ${manquants.join(', ')} ouverts`)
  }
  return lignes
}

export async function ouvrirCleoEtOriaUneFois(prisma: PrismaClient): Promise<string[] | null> {
  const done = await prisma.siteSetting.findUnique({ where: { key: CLEO_ORIA_KEY } })
  if (done !== null) return null
  const lignes = await ouvrirCleoEtOria(prisma)
  await prisma.siteSetting.upsert({
    where: { key: CLEO_ORIA_KEY },
    update: { value: new Date().toISOString() },
    create: { key: CLEO_ORIA_KEY, value: new Date().toISOString() },
  })
  return lignes
}
