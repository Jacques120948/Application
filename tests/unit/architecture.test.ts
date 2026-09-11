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
