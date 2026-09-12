import { describe, expect, it } from 'vitest'
import { nextOccurrence } from '@/server/marketing/publish'
import type { ScheduledPost } from '@/lib/marketing'

/**
 * Dates proposées pour une semaine.
 *
 * Le kit dit « lundi à 18:30 », pas une date. Les proposer dans le passé obligerait le
 * créateur à toutes les refaire avant de pouvoir programmer quoi que ce soit — ce qui
 * annulerait l'intérêt de l'envoi.
 */

function post(day: number, time: string): ScheduledPost {
  return {
    day,
    time,
    angleKey: 'PROBLEM_SOLUTION',
    objective: 'AWARENESS',
    format: 'POST',
    caption: 'Un texte',
    hashtags: [],
    cta: '',
  }
}

describe('dates proposées', () => {
  // Un mercredi, pour que le calcul ne tombe pas par hasard juste.
  const mercredi = new Date('2026-09-16T14:00:00')

  it('place la semaine à venir, jamais dans le passé', () => {
    const lundi = nextOccurrence(post(0, '09:00'), mercredi)
    expect(lundi).not.toBeNull()
    expect(lundi!.getTime()).toBeGreaterThan(mercredi.getTime())
    expect(lundi!.getDay()).toBe(1)
    expect(lundi!.getHours()).toBe(9)
  })

  it('respecte le jour de la semaine demandé', () => {
    expect(nextOccurrence(post(0, '09:00'), mercredi)!.getDay()).toBe(1)
    expect(nextOccurrence(post(4, '17:00'), mercredi)!.getDay()).toBe(5)
    expect(nextOccurrence(post(6, '19:00'), mercredi)!.getDay()).toBe(0)
  })

  it('garde les sept jours dans la même semaine, dans l’ordre', () => {
    const dates = [0, 1, 2, 3, 4, 5, 6].map((day) => nextOccurrence(post(day, '10:00'), mercredi)!)
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index]!.getTime()).toBeGreaterThan(dates[index - 1]!.getTime())
    }
    const ecart = dates[6]!.getTime() - dates[0]!.getTime()
    expect(Math.round(ecart / (24 * 60 * 60 * 1000))).toBe(6)
  })

  it('fonctionne aussi un dimanche, où le lundi suivant est le lendemain', () => {
    const dimanche = new Date('2026-09-20T20:00:00')
    const lundi = nextOccurrence(post(0, '08:00'), dimanche)!
    expect(lundi.getDay()).toBe(1)
    expect(lundi.getTime()).toBeGreaterThan(dimanche.getTime())
  })

  it('refuse une heure illisible plutôt que d’en inventer une', () => {
    expect(nextOccurrence(post(0, 'midi'), mercredi)).toBeNull()
    expect(nextOccurrence(post(0, '25:00'), mercredi)).toBeNull()
    expect(nextOccurrence(post(0, '10:99'), mercredi)).toBeNull()
  })
})
