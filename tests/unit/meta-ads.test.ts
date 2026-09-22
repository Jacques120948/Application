import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findProvider } from '@/server/integrations/catalog'
import { afterEach, beforeEach } from 'vitest'
import {
  jetonsDepuisMeta,
  MARGE_MS,
  messageRefusMeta,
  metaAds,
  PORTEES,
} from '@/server/ads/meta-ads'

/**
 * La connexion Meta, et les trois choses qui s'y perdraient en silence.
 *
 * Rien ici ne touche au réseau : ce qui se vérifie, ce sont les propriétés qui ne se voient
 * pas à l'usage. Un jeton mal daté ne casse rien aujourd'hui — il casse dans soixante jours,
 * chez tout le monde en même temps, et personne ne fait le rapprochement.
 */

describe('le connecteur Meta', () => {
  it('ne contient aucune fonction d’écriture', () => {
    /*
     * La garantie du produit, et elle ne peut pas venir de Meta : `ads_management` ouvre
     * l'écriture et il n'en existe pas de version restreinte. Ce qui empêche Evoliia de
     * modifier une campagne, c'est qu'aucune fonction ne sait le faire. Le jour où le mode
     * assisté en ajoutera une, ce test échouera — et c'est exactement ce qu'on veut : que
     * cette ligne soit franchie sciemment, dans un fichier séparé.
     */
    const source = readFileSync('src/server/ads/meta-ads.ts', 'utf8')
    for (const ecriture of ["method: 'POST'", "method: 'DELETE'", 'promoted_object']) {
      expect(source).not.toContain(ecriture)
    }
  })

  it('demande deux portées, et les déclare telles quelles au catalogue', () => {
    /*
     * La fiche du catalogue est ce que la personne lit avant de cliquer. Si elle annonçait
     * moins que ce que le code demande, elle mentirait — et l'écran de consentement de Meta
     * la contredirait trois secondes plus tard.
     */
    expect(PORTEES).toEqual(['ads_read', 'ads_management'])
    expect(findProvider('meta-ads')?.scopes).toEqual([...PORTEES])
  })

  it('ne demande pas business_management', () => {
    // Retirée après vérification : elle alourdit la revue de Meta sans servir à rien ici.
    expect([...PORTEES]).not.toContain('business_management')
    expect(findProvider('meta-ads')?.scopes).not.toContain('business_management')
  })
})

describe('l’adresse de consentement', () => {
  const avant = process.env.META_LOGIN_CONFIG_ID

  beforeEach(() => {
    delete process.env.META_LOGIN_CONFIG_ID
  })

  afterEach(() => {
    if (avant === undefined) delete process.env.META_LOGIN_CONFIG_ID
    else process.env.META_LOGIN_CONFIG_ID = avant
  })

  it('emporte l’état signé, les portées séparées par des virgules, et rien d’autre', () => {
    const url = new URL(metaAds.urlAutorisation('ETAT-SIGNE'))

    expect(url.hostname).toBe('www.facebook.com')
    expect(url.pathname).toMatch(/^\/v\d+\.\d+\/dialog\/oauth$/u)
    expect(url.searchParams.get('state')).toBe('ETAT-SIGNE')
    expect(url.searchParams.get('response_type')).toBe('code')
    // Meta sépare par des virgules là où Google emploie des espaces.
    expect(url.searchParams.get('scope')).toBe('ads_read,ads_management')
  })

  it('désigne la configuration au lieu des portées quand il y en a une', () => {
    /*
     * Login for Business : les portées vivent dans la configuration, et la personne y choisit
     * en plus les comptes qu'elle confie. C'est la forme que reçoit toute application créée
     * aujourd'hui à partir du cas d'usage « API Marketing ».
     */
    process.env.META_LOGIN_CONFIG_ID = '1234567890'
    const url = new URL(metaAds.urlAutorisation('ETAT'))

    expect(url.searchParams.get('config_id')).toBe('1234567890')
    /*
     * Les deux ne cohabitent pas : envoyer `scope` avec `config_id` fait refuser le dialogue,
     * avec un message de Meta qui ne dit pas lequel est de trop.
     */
    expect(url.searchParams.get('scope')).toBeNull()
  })

  it('retombe sur les portées quand aucune configuration n’est posée', () => {
    // Les installations plus anciennes emploient la connexion classique, et doivent continuer.
    const url = new URL(metaAds.urlAutorisation('ETAT'))

    expect(url.searchParams.get('config_id')).toBeNull()
    expect(url.searchParams.get('scope')).toBe('ads_read,ads_management')
  })

  it('n’emporte jamais le secret de l’application', () => {
    /*
     * L'adresse part dans le navigateur de la personne, et elle reste dans son historique.
     * Le secret n'y a rien à faire : il ne sert qu'à l'échange, côté serveur.
     */
    const url = metaAds.urlAutorisation('ETAT')
    expect(url).not.toContain('client_secret')
    expect(url).not.toContain('app_secret')
  })
})

describe('la date d’expiration enregistrée', () => {
  it('est antérieure à la vraie, et c’est ce qui fait tenir le renouvellement', () => {
    /*
     * Meta n'a pas de jeton de rafraîchissement : c'est le jeton longue durée lui-même
     * qu'on représente pour en obtenir un neuf, et l'échange échoue dès qu'il est expiré.
     * Enregistrer la vraie date ferait partir chaque renouvellement avec un jeton déjà
     * mort — une connexion qui tombe tous les deux mois, chez tout le monde à la fois.
     */
    const soixanteJours = 60 * 24 * 60 * 60
    const issue = jetonsDepuisMeta({ access_token: 'jeton', expires_in: soixanteJours })

    expect(issue.ok).toBe(true)
    if (!issue.ok) return

    const vraie = Date.now() + soixanteJours * 1000
    const ecart = vraie - issue.jetons.expiresAt.getTime()
    // Sept jours d'avance, à la seconde d'exécution près.
    expect(ecart).toBeGreaterThan(MARGE_MS - 5_000)
    expect(ecart).toBeLessThan(MARGE_MS + 5_000)
  })

  it('traite un jeton « sans expiration » comme soixante jours ordinaires', () => {
    /*
     * Meta omet `expires_in` pour les jetons qu'il déclare perpétuels, ce qui n'est vrai que
     * sur le papier : ils sont révoqués dès qu'un mot de passe change. Les dater à l'infini
     * arrêterait le renouvellement, et la panne surviendrait au pire moment.
     */
    const issue = jetonsDepuisMeta({ access_token: 'jeton' })

    expect(issue.ok).toBe(true)
    if (!issue.ok) return
    const jours = (issue.jetons.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(jours).toBeGreaterThan(50)
    expect(jours).toBeLessThan(54)
  })

  it('ne date jamais dans le passé, même pour un jeton plus court que la marge', () => {
    // Le cas limite : l'échange doit partir aussitôt, pas être considéré comme déjà perdu.
    const issue = jetonsDepuisMeta({ access_token: 'jeton', expires_in: 3600 })

    expect(issue.ok).toBe(true)
    if (!issue.ok) return
    expect(issue.jetons.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('porte le même jeton des deux côtés', () => {
    /*
     * Ce n'est pas une négligence : Meta n'ayant pas de jeton de rafraîchissement, c'est le
     * jeton long qu'on représente. Les deux colonnes doivent donc rester synchronisées, ce
     * que garantit le fait de les réécrire ensemble à chaque renouvellement.
     */
    const issue = jetonsDepuisMeta({ access_token: 'le-jeton-long', expires_in: 5_000_000 })

    expect(issue.ok).toBe(true)
    if (!issue.ok) return
    expect(issue.jetons.refreshToken).toBe('le-jeton-long')
    expect(issue.jetons.accessToken).toBe('le-jeton-long')
  })

  it('refuse une réponse sans jeton plutôt que d’en fabriquer un vide', () => {
    expect(jetonsDepuisMeta({}).ok).toBe(false)
    expect(jetonsDepuisMeta({ access_token: '' }).ok).toBe(false)
  })
})

describe('ce qu’on dit d’un refus de Meta', () => {
  it('nomme le geste avant de citer Meta', () => {
    const dit = messageRefusMeta(400, { code: 190, message: 'Session has expired' })

    expect(dit).toContain('Reconnectez')
    expect(dit).toContain('Session has expired')
  })

  it('distingue un droit manquant d’un jeton mort : le geste n’est pas le même', () => {
    const droit = messageRefusMeta(400, { code: 200, message: 'Permissions error' })
    const mort = messageRefusMeta(400, { code: 190, message: 'Invalid token' })

    expect(droit).toContain('rôle')
    expect(droit).not.toContain('Reconnectez')
    expect(mort).toContain('Reconnectez')
  })

  it('dit d’attendre quand Meta limite les appels, plutôt que de faire reconnecter', () => {
    for (const code of [4, 17, 32, 613]) {
      expect(messageRefusMeta(400, { code, message: 'rate limit' })).toContain('Réessayez')
    }
  })

  it('reste lisible quand Meta ne dit rien', () => {
    const dit = messageRefusMeta(500, undefined)

    expect(dit).toContain('indisponible')
    expect(dit).not.toContain('undefined')
  })

  it('ne recopie jamais une réponse sans fin', () => {
    // Un message de mille signes remplirait l'écran et pousserait le bouton hors de vue.
    const dit = messageRefusMeta(400, { code: 190, message: 'x'.repeat(2_000) })
    expect(dit.length).toBeLessThan(400)
  })
})
