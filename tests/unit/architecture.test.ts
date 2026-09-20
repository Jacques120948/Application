import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Règles de dépendance, vérifiées automatiquement.
 *
 * Ces règles sont la première barrière de l'isolation multi-tenant : si une route
 * appelait Prisma directement, elle contournerait la portée de locataire.
 * Voir docs/04-isolation-multi-tenant.md et docs/07-arborescence.md.
 */

function walk(directory: string): string[] {
  const entries: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) entries.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(name)) entries.push(path)
  }
  return entries
}

const sources = walk('src')
const read = (path: string) => readFileSync(path, 'utf8')

describe('règles de dépendance', () => {
  it("n'instancie PrismaClient qu'à un seul endroit", () => {
    const offenders = sources.filter(
      (path) => read(path).includes('new PrismaClient(') && path !== join('src', 'server', 'db', 'client.ts'),
    )
    expect(offenders).toEqual([])
  })

  it("n'accède à Prisma ni depuis les routes ni depuis les composants", () => {
    const offenders = sources
      .filter((path) => path.startsWith(join('src', 'app')) || path.startsWith(join('src', 'components')))
      .filter((path) => /from '@prisma\/client'|@\/server\/db\/client/.test(read(path)))
      .filter((path) => !/import type/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it("ne déchiffre un secret de créateur qu'au sein du gestionnaire d'intégrations", () => {
    /*
     * Un jeton OAuth ou une clé d'API appartient à quelqu'un d'autre. Plus il y a
     * d'endroits capables de les lire en clair, plus il y a d'endroits d'où ils peuvent
     * fuir. Un seul module déchiffre, et c'est celui qui expose `useCredential`.
     */
    const allowed = [
      join('src', 'lib', 'crypto.ts'),
      join('src', 'server', 'integrations', 'service.ts'),
    ]
    const offenders = sources
      .filter((path) => !allowed.includes(path))
      .filter((path) => read(path).includes('decryptSecret'))
    expect(offenders).toEqual([])
  })

  it('interdit au serveur de dépendre des pages', () => {
    const offenders = sources
      .filter((path) => path.startsWith(join('src', 'server')))
      .filter((path) => read(path).includes("from '@/app"))
    expect(offenders).toEqual([])
  })

  it("n'importe depuis les composants que des types du serveur", () => {
    const offenders: string[] = []
    for (const path of sources.filter((candidate) => candidate.startsWith(join('src', 'components')))) {
      for (const line of read(path).split('\n')) {
        if (line.includes("from '@/server/") && !line.trimStart().startsWith('import type')) {
          offenders.push(`${path} :: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * Règle née d'un vrai incident : `prisma.project.count()` appelé hors portée de
   * locataire renvoyait zéro, parce que le Row Level Security masque les projets non
   * publiés quand aucun contexte n'est posé. La limite de projets de l'offre était donc
   * silencieusement désactivée. Une lecture filtrée ne lève aucune erreur : seule une
   * règle automatique empêche la réintroduction.
   */
  it('accède aux tables protégées uniquement dans une portée de locataire', () => {
    const protectedModels = [
      'project',
      'projectVersion',
      'chatMessage',
      'projectCheck',
      'appRecord',
      'appEndUser',
      'appEndUserSession',
      'appEvent',
      'appPurchase',
      'idea',
      'creatorProfile',
      'integrationConnection',
      'integrationCredential',
      'integrationEvent',
      'agentNote',
      'radarRun',
      'radarFeedback',
      'radarSignal',
      'supportSettings',
      'supportKnowledgeEntry',
      'supportConversation',
      'supportMessage',
      'supportTicket',
      'supportInsight',
      'notification',
    ]
    // Ces deux fichiers lisent délibérément des applications publiées, qui sont publiques.
    const allowed = new Set([
      join('src', 'server', 'runtime', 'published.ts'),
      join('src', 'server', 'runtime', 'context.ts'),
    ])
    const pattern = new RegExp(`\\bprisma\\.(${protectedModels.join('|')})\\.`)

    const offenders = sources
      .filter((path) => !allowed.has(path))
      .filter((path) => pattern.test(read(path)))
    expect(offenders).toEqual([])
  })

  /**
   * Le back-office écrit en base sans repasser par le parcours. Toute route ajoutée sous
   * /api/admin doit donc traverser le service qui vérifie le rôle : une route qui appelle
   * Prisma directement ouvrirait l'administration à n'importe qui.
   */
  it("n'expose aucune route d'administration non gardée", () => {
    const adminRoutes = sources.filter((path) =>
      path.startsWith(join('src', 'app', 'api', 'admin')),
    )
    expect(adminRoutes.length).toBeGreaterThan(0)
    const offenders = adminRoutes.filter(
      (path) => !read(path).includes("from '@/server/admin/service'"),
    )
    expect(offenders).toEqual([])
  })

  it("vérifie l'origine sur toute écriture d'administration", () => {
    const offenders = sources
      .filter((path) => path.startsWith(join('src', 'app', 'api', 'admin')))
      .filter((path) => !read(path).includes('assertSameOrigin'))
    expect(offenders).toEqual([])
  })

  it('dit au bandeau qui est administrateur, sur toutes les pages', () => {
    /*
     * Le bandeau reçoit `isAdmin` par propriété, et sa valeur par défaut est « non ». Six
     * pages sur neuf ne la transmettaient pas : le lien vers l'administration disparaissait
     * dès qu'on ouvrait Visibilité, c'est-à-dire partout où l'on passe son temps. Rien
     * n'échouait, rien n'était journalisé — le lien n'était simplement pas là.
     *
     * C'est la forme de défaut qu'aucun test d'usage ne rattrape : il faut le chercher là
     * où il naît, dans l'oubli d'une propriété facultative.
     */
    const offenders = sources
      .filter((path) => path.startsWith(join('src', 'app')) && path.endsWith('page.tsx'))
      .filter((path) => read(path).includes('<Shell'))
      .filter((path) => !read(path).includes('isAdmin'))
    expect(offenders).toEqual([])
  })

  it("n'expose aucun secret au navigateur", () => {
    const offenders = sources
      .filter((path) => path.startsWith(join('src', 'components')))
      .filter((path) => /process\.env\.(?!NEXT_PUBLIC_)/.test(read(path)))
    expect(offenders).toEqual([])
  })

  it('ne laisse aucun secret en dur dans le code', () => {
    const suspicious = /(sk-ant-[A-Za-z0-9]|sk_live_|AKIA[0-9A-Z]{16})/
    const offenders = sources.filter((path) => suspicious.test(read(path)))
    expect(offenders).toEqual([])
  })
})
