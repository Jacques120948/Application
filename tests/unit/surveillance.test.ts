import { describe, expect, it } from 'vitest'
import { comparer, CONTROLES, type Reference } from '@/server/audit/surveillance'
import type { PageExploree } from '@/server/audit/crawler'

/**
 * La règle qui sépare la surveillance de l'audit.
 *
 * L'audit dit ce qui est, la surveillance dit ce qui a changé. Un site sans description
 * depuis toujours, c'est un constat d'audit et une ligne du plan d'action ; une description
 * qui disparaît cette semaine, c'est une alerte. Sans cette règle les deux écrans
 * répéteraient la même chose, et l'on cesserait de lire les deux.
 */

const ORIGIN = 'https://exemple-veille.ch'

function page(champs: Partial<PageExploree['signals']> & { url?: string }): PageExploree {
  const { url, ...signaux } = champs
  return {
    url: url ?? ORIGIN,
    path: '/',
    depth: 0,
    statusCode: 200,
    bytes: 100,
    fetchMs: 10,
    redirects: 0,
    signals: {
      title: 'Un titre',
      description: 'Une description qui dit ce que la page contient.',
      canonical: '',
      robotsMeta: '',
      h1: [],
      links: [],
      images: [],
      headings: [],
      intro: '',
      wordCount: 200,
      lang: 'fr',
      jsonLd: [],
      hasViewport: true,
      author: '',
      ...signaux,
    } as unknown as PageExploree['signals'],
  }
}

function repere(champs: Partial<Reference> = {}): Reference {
  return {
    url: ORIGIN,
    avaitTitre: true,
    avaitDescription: true,
    etaitNoindex: false,
    ...champs,
  }
}

describe('la surveillance ne signale que ce qui a changé', () => {
  it('signale un titre qui disparaît', () => {
    const constats = comparer([repere()], [page({ title: '  ' })], ORIGIN)
    expect(constats.map((constat) => constat.checkId)).toContain('watch.title_missing')
  })

  it('se tait sur un titre qui n’a jamais existé', () => {
    /*
     * C'est le cœur de la règle. Cette page est en défaut, et l'audit le dit déjà dans le
     * plan d'action. Le répéter ici ferait de la surveillance un second plan d'action, et
     * le jour où le site tombe vraiment, l'alerte se perdrait au milieu des autres.
     */
    const constats = comparer([repere({ avaitTitre: false })], [page({ title: '' })], ORIGIN)
    expect(constats.map((constat) => constat.checkId)).not.toContain('watch.title_missing')
  })

  it('signale une description qui disparaît, se tait sur celle qui manquait déjà', () => {
    expect(
      comparer([repere()], [page({ description: '' })], ORIGIN).map((c) => c.checkId),
    ).toContain('watch.description_missing')
    expect(
      comparer([repere({ avaitDescription: false })], [page({ description: '' })], ORIGIN).map(
        (c) => c.checkId,
      ),
    ).not.toContain('watch.description_missing')
  })

  it('signale un noindex apparu, se tait sur un noindex de toujours', () => {
    expect(
      comparer([repere()], [page({ robotsMeta: 'noindex, nofollow' })], ORIGIN).map(
        (c) => c.checkId,
      ),
    ).toContain('watch.noindex')
    expect(
      comparer([repere({ etaitNoindex: true })], [page({ robotsMeta: 'noindex' })], ORIGIN).map(
        (c) => c.checkId,
      ),
    ).not.toContain('watch.noindex')
  })

  it('ne dit rien d’un site qui n’a pas bougé', () => {
    expect(comparer([repere()], [page({})], ORIGIN)).toEqual([])
  })
})

describe('l’accueil détourné', () => {
  it('se repère à ce que la page déclare, pas à ce qu’elle affiche', () => {
    /*
     * Un domaine expiré ou détourné rend une page parfaitement valide : elle répond, elle a
     * un titre, elle a une description. Seule l'adresse qu'elle déclare sienne la trahit.
     */
    const constats = comparer(
      [repere()],
      [page({ canonical: 'https://parking-domaine.example/vente' })],
      ORIGIN,
    )
    expect(constats.map((constat) => constat.checkId)).toContain('watch.offsite_redirect')
  })

  it('ne s’alarme pas d’une adresse canonique du même site', () => {
    const constats = comparer([repere()], [page({ canonical: `${ORIGIN}/` })], ORIGIN)
    expect(constats.map((constat) => constat.checkId)).not.toContain('watch.offsite_redirect')
  })

  it('ne regarde que l’accueil', () => {
    const ailleurs = `${ORIGIN}/boutique`
    const constats = comparer(
      [repere({ url: ailleurs })],
      [page({ url: ailleurs, canonical: 'https://autre.example/x' })],
      ORIGIN,
    )
    expect(constats).toEqual([])
  })
})

describe('la liste des contrôles', () => {
  it('reste courte, et chacun dit ce qu’il coûte', () => {
    /*
     * Une surveillance qui signale quinze choses par semaine ne se lit plus. La borne est
     * volontaire : ce test la rend visible le jour où quelqu'un voudra en ajouter dix.
     */
    const ids = Object.keys(CONTROLES)
    expect(ids.length).toBeLessThanOrEqual(8)
    for (const id of ids) {
      expect(id.startsWith('watch.'), id).toBe(true)
      expect(CONTROLES[id]?.label.length, id).toBeGreaterThan(10)
      expect(CONTROLES[id]?.why.length, id).toBeGreaterThan(40)
    }
  })
})
