import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { login, register } from '@/server/auth/service'
import { MAX_ATTEMPTS, MAX_ATTEMPTS_IP } from '@/server/auth/throttle'
import { IDLE_TIMEOUT_MS } from '@/server/auth/session'

/**
 * La porte d'entrée.
 *
 * C'est le seul endroit du produit qu'un inconnu peut marteler sans compte et sans limite
 * naturelle. Quatre propriétés méritent donc un test, et chacune répond à une façon
 * d'entrer.
 *
 * **Cinq essais, et la limite survit au processus.** Il existait déjà un compteur en
 * mémoire ; il ne pouvait pas être la limite, puisque sur un hébergement sans état chaque
 * requête peut tomber sur une instance neuve dont le compteur est vide. Le test simule
 * exactement cela : on vide la mémoire entre chaque tentative, et le blocage doit tenir.
 *
 * **Le compte et l'adresse d'où l'on vient sont comptés séparément.** L'un protège un compte
 * qu'on s'acharne à ouvrir, l'autre protège tous les comptes de quelqu'un qui essaie un mot
 * de passe courant sur des milliers d'adresses.
 *
 * **Le blocage ne trahit pas qui est client.** Une adresse inscrite et une adresse inventée
 * donnent le même message.
 *
 * **Une session inactive ne reste pas ouverte.** Vingt minutes sans signe de vie, et elle
 * est révoquée — pas seulement ignorée.
 */

/*
 * Le cookie de session, simulé.
 *
 * Hors d'une requête, Next n'a pas de magasin de cookies et `getCurrentUser` rend `null`
 * avant même de regarder l'activité. Sans ce faux magasin, le test de l'inactivité
 * passerait sans rien éprouver — il l'a fait une fois, et c'est pour cela qu'il est là.
 */
let cookieCourant: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nom: string) =>
      nom === 'af_session' && cookieCourant !== undefined
        ? { name: nom, value: cookieCourant }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}))

const MOT_DE_PASSE = 'motdepasse-2026-solide'
let email: string
let userId: string

/** Une adresse IP propre à chaque cas : sans cela, le compteur d'IP les mélangerait. */
function ip(): string {
  return `203.0.113.${Math.floor(Math.random() * 200) + 10}`
}

beforeAll(async () => {
  clearAll()
  email = `connexion-${Date.now()}@exemple.test`
  userId = (await register({ email, password: MOT_DE_PASSE, locale: 'fr' }, { ip: ip() })).userId
}, 60_000)

beforeEach(async () => {
  clearAll()
  await prisma.authThrottle.deleteMany({})
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
  await prisma.authThrottle.deleteMany({})
})

describe('cinq tentatives, et pas une de plus', () => {
  it('bloque au cinquième échec, et le blocage survit au redémarrage du processus', async () => {
    const source = ip()
    for (let essai = 1; essai < MAX_ATTEMPTS; essai += 1) {
      /*
       * La mémoire est vidée avant chaque essai : c'est exactement ce que voit une nouvelle
       * instance sans état. Si la limite ne tenait que là, aucun blocage n'arriverait jamais.
       */
      clearAll()
      await expect(
        login({ email, password: 'mauvais-mot-de-passe' }, { ip: source }),
        `essai ${essai}`,
      ).rejects.toThrow(/incorrect/i)
    }

    clearAll()
    // Le cinquième annonce déjà l'attente, plutôt que de laisser croire qu'un sixième existe.
    await expect(login({ email, password: 'mauvais-mot-de-passe' }, { ip: source })).rejects.toMatchObject(
      { code: 'RATE_LIMITED' },
    )

    // Et le bon mot de passe ne rouvre pas la porte tant que le blocage court.
    clearAll()
    await expect(login({ email, password: MOT_DE_PASSE }, { ip: source })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  }, 60_000)

  it('laisse entrer avant la limite, et efface l’ardoise du compte', async () => {
    const source = ip()
    clearAll()
    await expect(login({ email, password: 'presque' }, { ip: source })).rejects.toThrow(/incorrect/i)

    clearAll()
    const session = await login({ email, password: MOT_DE_PASSE }, { ip: source })
    expect(session.userId).toBe(userId)

    // L'ardoise du compte est repartie de zéro : l'échec précédent ne compte plus.
    const restant = await prisma.authThrottle.count({ where: { scope: 'email' } })
    expect(restant).toBe(0)
  }, 30_000)

  it('ne dit pas si l’adresse existe, même en bloquant', async () => {
    const inconnue = `fantome-${Date.now()}@exemple.test`
    const source = ip()
    let message = ''
    for (let essai = 0; essai < MAX_ATTEMPTS; essai += 1) {
      clearAll()
      await login({ email: inconnue, password: 'peu importe' }, { ip: source }).catch(
        (error: Error) => {
          message = error.message
        },
      )
    }
    // Le même refus qu'une adresse inscrite : le blocage ne devient pas un révélateur.
    expect(message).toMatch(/Trop de tentatives/i)
  }, 60_000)
})

describe('le compte et l’origine sont comptés séparément', () => {
  it('tolère davantage d’échecs depuis une même adresse que sur un même compte', () => {
    /*
     * Un bureau, un réseau mobile, un café partagent une adresse. Le même seuil pour les
     * deux ferait bloquer des collègues innocents dès qu'un seul se trompe cinq fois.
     */
    expect(MAX_ATTEMPTS_IP).toBeGreaterThan(MAX_ATTEMPTS)
    expect(MAX_ATTEMPTS).toBe(5)
  })

  it('ne rend pas un crédit d’essais neuf à qui finit par ouvrir un compte', async () => {
    const source = ip()
    clearAll()
    await expect(login({ email, password: 'raté' }, { ip: source })).rejects.toThrow(/incorrect/i)
    clearAll()
    await login({ email, password: MOT_DE_PASSE }, { ip: source })

    // Le compteur de l'origine survit à la réussite ; celui du compte, non.
    expect(await prisma.authThrottle.count({ where: { scope: 'ip' } })).toBe(1)
    expect(await prisma.authThrottle.count({ where: { scope: 'email' } })).toBe(0)
  }, 30_000)
})

describe('une session inactive ne reste pas ouverte', () => {
  it('laisse passer tant qu’il y a de l’activité', async () => {
    clearAll()
    const session = await login({ email, password: MOT_DE_PASSE }, { ip: ip() })
    cookieCourant = session.token

    const { getCurrentUser } = await import('@/server/auth/session')
    const vu = await getCurrentUser()
    expect(vu?.id).toBe(userId)
  }, 30_000)

  it('révoque la session au-delà du délai, et le jeton ne rouvre plus rien', async () => {
    clearAll()
    const session = await login({ email, password: MOT_DE_PASSE }, { ip: ip() })
    cookieCourant = session.token
    const ligne = await prisma.session.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    // On la fait vieillir d'une minute de trop, comme le ferait une pause déjeuner.
    await prisma.session.update({
      where: { id: ligne.id },
      data: { lastSeenAt: new Date(Date.now() - IDLE_TIMEOUT_MS - 60_000) },
    })

    const { getCurrentUser } = await import('@/server/auth/session')
    expect(await getCurrentUser()).toBeNull()

    /*
     * Révoquée, pas seulement ignorée : un jeton volé après coup ne rouvre rien, et la ligne
     * ne redeviendra pas valide à la faveur d'une erreur de calcul de date.
     */
    const apres = await prisma.session.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(apres.revokedAt).not.toBeNull()

    // Et une seconde présentation du même jeton reste refusée.
    expect(await getCurrentUser()).toBeNull()
    cookieCourant = undefined
  }, 30_000)

  it('rafraîchit la trace d’activité quand on revient', async () => {
    clearAll()
    const session = await login({ email, password: MOT_DE_PASSE }, { ip: ip() })
    cookieCourant = session.token
    const ligne = await prisma.session.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    // Cinq minutes plus tôt : au-delà du palier d'écriture, bien en deçà du délai.
    const ancien = new Date(Date.now() - 5 * 60_000)
    await prisma.session.update({ where: { id: ligne.id }, data: { lastSeenAt: ancien } })

    const { getCurrentUser } = await import('@/server/auth/session')
    expect((await getCurrentUser())?.id).toBe(userId)

    const apres = await prisma.session.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(apres.lastSeenAt.getTime()).toBeGreaterThan(ancien.getTime())
    cookieCourant = undefined
  }, 30_000)
})
