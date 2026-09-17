import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildImagePrompt, IMAGE_DAILY_LIMIT } from '@/server/media/generate'
import { generateOpenAiImage, verifyOpenAiKey } from '@/server/integrations/providers/openai'
import { generateGeminiImage, verifyGeminiKey } from '@/server/integrations/providers/gemini'
import { findProvider } from '@/server/integrations/catalog'
import { findVerifier } from '@/server/integrations/verify'
import { DEFAULT_THEME } from '@/server/spec/templates'

/**
 * Images générées avec la clé du créateur : la description envoyée, la lecture des
 * réponses des fournisseurs, et la traduction de leurs refus. Aucun appel réseau réel.
 */

const spec = { name: 'Atelier', theme: DEFAULT_THEME }

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  )
}

/** Combien de fois le réseau a été appelé : un refus de forme ne doit rien appeler. */
function fetchAppels(): number {
  return (globalThis.fetch as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0
}

describe('description envoyée au fournisseur', () => {
  it('ajoute le style de l’application et interdit texte, logo et personne réelle', () => {
    const prompt = buildImagePrompt('  Un atelier de menuiserie  ', spec)
    expect(prompt.startsWith('Un atelier de menuiserie')).toBe(true)
    expect(prompt).toContain(DEFAULT_THEME.colors.primary)
    expect(prompt).toContain('sans aucun texte')
    expect(prompt).toContain('sans personne réelle')
  })

  it('a un plafond journalier qui protège le compte du créateur', () => {
    expect(IMAGE_DAILY_LIMIT).toBeGreaterThan(0)
    expect(IMAGE_DAILY_LIMIT).toBeLessThanOrEqual(50)
  })
})

describe('catalogue', () => {
  it('ouvre OpenAI et Google Gemini par clé du créateur, sans coût pour Evoliia', () => {
    for (const id of ['openai', 'google-gemini']) {
      const provider = findProvider(id)
      expect(provider?.status).toBe('available')
      expect(provider?.credential).toBe('API_KEY')
      expect(provider?.costToEvoliia).toBe('aucun')
      expect(provider?.keyHelp).toBeDefined()
      expect(findVerifier(id)).toBeDefined()
    }
  })
})

describe('vérification des clés', () => {
  it('refuse une clé au mauvais format sans appeler le fournisseur', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect((await verifyOpenAiKey('pas-une-cle')).ok).toBe(false)
    expect((await verifyGeminiKey('pas-une-cle')).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('traduit un refus du fournisseur', async () => {
    stubFetch(401, {})
    const verdict = await verifyOpenAiKey('sk-test-0123456789')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('refuse')
  })

  it('accepte les deux formats de clé Google, sans coder le préfixe en dur', async () => {
    /*
     * Le contrôle exigeait « AIza », et Google a commencé à délivrer des clés en « AQ. » :
     * des clés parfaitement valides étaient refusées avant d'atteindre le réseau. On ne
     * vérifie donc plus que ce qui ne peut être vrai d'aucune clé, et c'est le fournisseur
     * qui tranche.
     */
    stubFetch(200, { data: [] })
    expect(await verifyGeminiKey('AIzaSyTest0123456789abcdefghij')).toMatchObject({ ok: true })
    stubFetch(200, { data: [] })
    expect(await verifyGeminiKey('AQ.Ab8RN6JTest0123456789abcdefghij')).toMatchObject({ ok: true })
  })

  it('refuse un texte d’exemple recollé tel quel, sans appeler le fournisseur', async () => {
    const avant = fetchAppels()
    for (const faux of ['', '   ', 'TA_VRAIE_CLE', 'votre clé ici']) {
      expect(await verifyGeminiKey(faux), faux).toMatchObject({ ok: false })
    }
    expect(fetchAppels()).toBe(avant)
  })
})

describe('lecture des réponses', () => {
  it('décode une image OpenAI en base64', async () => {
    stubFetch(200, { data: [{ b64_json: Buffer.from('bonjour').toString('base64') }] })
    const result = await generateOpenAiImage('sk-x', 'un atelier')
    expect(result.ok).toBe(true)
    if (result.ok) expect(Buffer.from(result.bytes).toString()).toBe('bonjour')
  })

  it('décode une image Gemini dans les parties de la réponse', async () => {
    stubFetch(200, {
      candidates: [{ content: { parts: [{ text: 'voici' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('img').toString('base64') } }] } }],
    })
    const result = await generateGeminiImage('AIza', 'un atelier')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mime).toBe('image/png')
  })

  it('distingue clé refusée, quota atteint et description refusée', async () => {
    stubFetch(403, {})
    expect(await generateOpenAiImage('sk-x', 'x')).toMatchObject({ ok: false, kind: 'key' })
    stubFetch(429, {})
    expect(await generateOpenAiImage('sk-x', 'x')).toMatchObject({ ok: false, kind: 'quota' })
    stubFetch(400, {})
    expect(await generateGeminiImage('AIza', 'x')).toMatchObject({ ok: false, kind: 'refused' })
    stubFetch(200, { candidates: [] })
    expect(await generateGeminiImage('AIza', 'x')).toMatchObject({ ok: false, kind: 'refused' })
  })

  it('ne laisse jamais la clé dans l’adresse appelée', async () => {
    stubFetch(200, { candidates: [] })
    await generateGeminiImage('AIzaSecret', 'x')
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('AIzaSecret')
    expect(JSON.stringify(init.headers)).toContain('AIzaSecret')
  })
})
