import type { Prisma } from '@prisma/client'
import { analyseNova, syntheseNova } from '@/server/ai/operations'
import { novaAnalyseSchema, novaSyntheseSchema, type NovaAnalyseIA, type NovaSyntheseIA } from '@/server/ai/schemas'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { faitsNova } from './contexte'
import { lireNova } from './service'

/**
 * Ce que Nova écrit sur demande, et seulement sur demande.
 *
 * Tout l'écran de Nova est gratuit : les chiffres, les comparaisons, les alertes sont du
 * calcul. Deux écrits coûtent des crédits, parce qu'ils appellent un modèle, et chacun le
 * modèle qu'il mérite (routing.ts) :
 *
 * - **la synthèse** — la période en cinq phrases, modèle économique ;
 * - **l'analyse approfondie** — toutes les sources croisées, trois priorités avec le
 *   spécialiste qui peut agir, modèle de raisonnement.
 *
 * Le modèle reçoit les mêmes faits calculés que la conversation (contexte.ts), comme des
 * données. Un écrit demandé deux fois en dix minutes sur la même période est relu, pas
 * repayé : un double clic ne coûte rien.
 */

export type GenreEcrit = 'synthese' | 'approfondie'

export type EcritNova =
  | { genre: 'synthese'; contenu: NovaSyntheseIA; periode: string; createdAt: Date; creditsSpent: number }
  | { genre: 'approfondie'; contenu: NovaAnalyseIA; periode: string; createdAt: Date; creditsSpent: number }

/** Ce qu'une synthèse et une analyse coûtent d'ordinaire, annoncé sur le bouton. */
export const COUT_ECRIT: Record<GenreEcrit, { min: number; max: number }> = {
  synthese: { min: 1, max: 2 },
  approfondie: { min: 6, max: 12 },
}

const DOUBLON_MS = 10 * 60 * 1000

function relire(ligne: { genre: string; contenu: Prisma.JsonValue; periode: string; createdAt: Date; creditsSpent: number }): EcritNova | null {
  if (ligne.genre === 'synthese') {
    const contenu = novaSyntheseSchema.safeParse(ligne.contenu)
    return contenu.success ? { genre: 'synthese', contenu: contenu.data, periode: ligne.periode, createdAt: ligne.createdAt, creditsSpent: ligne.creditsSpent } : null
  }
  const contenu = novaAnalyseSchema.safeParse(ligne.contenu)
  return contenu.success ? { genre: 'approfondie', contenu: contenu.data, periode: ligne.periode, createdAt: ligne.createdAt, creditsSpent: ligne.creditsSpent } : null
}

/** Les derniers écrits de la personne, les plus récents d'abord. */
export async function derniersEcrits(userId: string, nombre = 3): Promise<EcritNova[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.novaAnalyse.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: nombre,
      select: { genre: true, contenu: true, periode: true, createdAt: true, creditsSpent: true },
    }),
  )
  return lignes.map(relire).filter((un): un is EcritNova => un !== null)
}

export async function ecrireNova(
  userId: string,
  genre: GenreEcrit,
  locale: string,
  options: { periode?: string; du?: string; au?: string; siteId?: string } = {},
): Promise<EcritNova> {
  // Le droit passe avant la dépense ; le solde est vérifié par l'opération elle-même.
  requireFeature(await getEntitlements(userId), 'nova_agent')
  consume(`nova-ecrit:${userId}`, RULES.aiOperation)

  const vue = await lireNova(userId, locale, options)
  const recent = await withUserScope(userId, (tx) =>
    tx.novaAnalyse.findFirst({
      where: { userId, genre, du: new Date(vue.periode.du), au: new Date(vue.periode.au), createdAt: { gte: new Date(Date.now() - DOUBLON_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { genre: true, contenu: true, periode: true, createdAt: true, creditsSpent: true },
    }),
  )
  const relu = recent === null ? null : relire(recent)
  if (relu !== null) return relu

  const faits = faitsNova(vue).join('\n')
  const parametres = { userId, locale, periode: vue.periode.libelle, faits }
  const resultat = genre === 'synthese' ? await syntheseNova(parametres) : await analyseNova(parametres)
  await withUserScope(userId, (tx) =>
    tx.novaAnalyse.create({
      data: {
        userId,
        genre,
        periode: vue.periode.libelle,
        du: new Date(vue.periode.du),
        au: new Date(vue.periode.au),
        contenu: resultat.value as unknown as Prisma.InputJsonValue,
        creditsSpent: resultat.creditsSpent,
      },
    }),
  )
  logger.info('écrit de Nova', { genre, credits: resultat.creditsSpent })
  return genre === 'synthese'
    ? { genre, contenu: resultat.value as NovaSyntheseIA, periode: vue.periode.libelle, createdAt: new Date(), creditsSpent: resultat.creditsSpent }
    : { genre, contenu: resultat.value as NovaAnalyseIA, periode: vue.periode.libelle, createdAt: new Date(), creditsSpent: resultat.creditsSpent }
}
