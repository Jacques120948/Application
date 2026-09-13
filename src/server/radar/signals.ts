import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'

/**
 * Signaux extérieurs du Radar (V2).
 *
 * Le Radar V1 ne connaît que le profil et le modèle. La V2 prévoit d'y ajouter des
 * observations venues d'ailleurs — tendances de recherche, actualités d'un secteur,
 * nouveaux entrants — pour que « pourquoi maintenant » repose sur autre chose que la
 * culture générale du modèle.
 *
 * Ce fichier pose l'architecture, pas les connexions : chaque source est un adaptateur
 * derrière une interface unique, et un adaptateur sans clé se déclare simplement absent.
 * Rien n'est appelé, rien n'est facturé, tant qu'une source n'est pas configurée par
 * l'administrateur — chaque connexion extérieure pouvant coûter, elle reste une décision
 * humaine. L'écran le dit tel quel : « Connexion externe requise pour activer cette
 * partie. »
 *
 * Un signal enregistré est toujours une observation datée, avec une confiance déclarée
 * par sa source. Ce n'est jamais une vérité : le modèle le reçoit comme donnée, sous
 * étiquette, et l'interface le montre comme « signal », pas comme « fait ».
 */

export type SignalType = 'search_trend' | 'regulation' | 'new_entrant' | 'news' | 'other'

export type Signal = {
  type: SignalType
  summary: string
  url: string | null
  /** 0 à 100, déclarée par la source. */
  confidence: number
  observedAt: Date
}

export type SignalQuery = {
  /** Secteur et centres d'intérêt de la personne, ou le nom d'un projet. */
  topic: string
  locale: string
  /** Étendue de marché : local, francophone, international. */
  scope: string
}

export interface SignalSource {
  readonly id: string
  readonly label: string
  /** Vrai quand la clé ou l'adresse nécessaire est présente dans l'environnement. */
  isConfigured(): boolean
  /** Variables d'environnement attendues, pour l'écran d'administration. */
  readonly requires: readonly string[]
  fetch(query: SignalQuery): Promise<Signal[]>
}

function read(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * Tendances de recherche. Aucun fournisseur retenu à ce jour : l'adaptateur attend une
 * adresse et une clé, et n'existe qu'à travers elles.
 */
const searchTrends: SignalSource = {
  id: 'search_trends',
  label: 'Tendances de recherche',
  requires: ['RADAR_TRENDS_API_URL', 'RADAR_TRENDS_API_KEY'],
  isConfigured: () => read('RADAR_TRENDS_API_URL') !== undefined && read('RADAR_TRENDS_API_KEY') !== undefined,
  async fetch() {
    // Volontairement vide : le contrat d'appel dépend du fournisseur qui sera choisi.
    // Un adaptateur configuré sans implémentation ne doit rien inventer.
    return []
  },
}

/** Actualités d'un secteur. Même logique. */
const sectorNews: SignalSource = {
  id: 'sector_news',
  label: 'Actualités du secteur',
  requires: ['RADAR_NEWS_API_URL', 'RADAR_NEWS_API_KEY'],
  isConfigured: () => read('RADAR_NEWS_API_URL') !== undefined && read('RADAR_NEWS_API_KEY') !== undefined,
  async fetch() {
    return []
  },
}

export const SIGNAL_SOURCES: readonly SignalSource[] = [searchTrends, sectorNews]

export type SignalSourceStatus = { id: string; label: string; configured: boolean; requires: string[] }

/** L'état des sources, pour l'écran : ce qui est branché et ce qui manque. */
export function signalSourcesStatus(): SignalSourceStatus[] {
  return SIGNAL_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    configured: source.isConfigured(),
    requires: [...source.requires],
  }))
}

export function anySignalSourceConfigured(): boolean {
  return SIGNAL_SOURCES.some((source) => source.isConfigured())
}

/**
 * Interroge les sources configurées et garde ce qu'elles renvoient.
 *
 * Une source qui échoue ne fait pas échouer la recherche : le Radar sait fonctionner sans
 * signal, il l'a toujours fait. L'erreur est journalisée sans le contenu de la requête.
 */
export async function collectSignals(userId: string, query: SignalQuery): Promise<Signal[]> {
  const collected: Signal[] = []
  for (const source of SIGNAL_SOURCES) {
    if (!source.isConfigured()) continue
    try {
      const signals = await source.fetch(query)
      collected.push(...signals.slice(0, 10))
      if (signals.length > 0) {
        await withUserScope(userId, (tx) =>
          tx.radarSignal.createMany({
            data: signals.slice(0, 10).map((signal) => ({
              userId,
              source: source.id,
              type: signal.type,
              url: signal.url,
              summary: signal.summary.slice(0, 500),
              confidence: Math.max(0, Math.min(100, Math.round(signal.confidence))),
              observedAt: signal.observedAt,
            })),
          }),
        )
      }
    } catch (error) {
      logger.warn('radar : source de signaux en échec', {
        source: source.id,
        error: error instanceof Error ? error.message : 'inconnue',
      })
    }
  }
  return collected
}

/** Les signaux tels que le modèle les reçoit : une ligne datée par observation. */
export function describeSignals(signals: Signal[]): string[] {
  return signals.map(
    (signal) =>
      `[${signal.type}, confiance ${signal.confidence}/100, ${signal.observedAt.toISOString().slice(0, 10)}] ${signal.summary}`,
  )
}
