'use client'

import { useState } from 'react'

/**
 * Ce que les assistants répondent quand on leur pose vos questions.
 *
 * L'écran doit tenir une promesse difficile : dire une fréquence sans qu'on la lise comme
 * un verdict. « Vue dans 3 relevés sur 10 » n'est pas « pas visible » — ces réponses ne
 * sont pas déterministes, et une absence un mardi ne veut rien dire. Le chiffre est donc
 * toujours écrit en deux parties, jamais en pourcentage seul, et le passage qui a compté
 * est consultable : personne n'a à nous croire sur parole.
 *
 * Ce que l'écran ne fait pas non plus : promettre. Aucune action ne « fera apparaître »
 * une marque dans un assistant, et rien ici ne le laisse entendre.
 */

export type FrequenceVue = {
  prompt: { id: string; texte: string; theme: string; actif: boolean }
  releves: number
  mentions: number
  sentiment: string
  sources: string[]
}

const TONS: Record<string, { texte: string; couleur: string }> = {
  bon: { texte: 'Cité en bien', couleur: 'var(--color-positive)' },
  neutre: { texte: 'Cité sans opinion', couleur: 'var(--color-ink-soft)' },
  reserve: { texte: 'Cité avec réserve', couleur: 'var(--color-caution)' },
  inconnu: { texte: '—', couleur: 'var(--color-ink-faint)' },
}

const PLATEFORMES: Record<string, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
}

function Ligne({
  frequence,
  onBasculer,
  onRetirer,
}: {
  frequence: FrequenceVue
  onBasculer: (actif: boolean) => void
  onRetirer: () => void
}) {
  const ton = TONS[frequence.sentiment] ?? TONS.inconnu
  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className={`m-0 text-sm ${frequence.prompt.actif ? '' : 'opacity-50'}`}>
          {frequence.prompt.texte}
        </p>
        <p className="m-0 text-xs whitespace-nowrap text-[var(--color-ink-faint)]">
          {frequence.releves === 0 ? (
            'Jamais posée'
          ) : (
            <>
              Vue dans{' '}
              <span className="font-medium text-[var(--color-ink)]">
                {frequence.mentions} relevé{frequence.mentions > 1 ? 's' : ''} sur{' '}
                {frequence.releves}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {frequence.mentions === 0 ? null : (
          <span className="text-xs" style={{ color: ton?.couleur }}>
            {ton?.texte}
          </span>
        )}
        <button
          type="button"
          onClick={() => onBasculer(!frequence.prompt.actif)}
          className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--color-ink-soft)] underline"
        >
          {frequence.prompt.actif ? 'Ne plus poser' : 'Poser à nouveau'}
        </button>
        <button
          type="button"
          onClick={onRetirer}
          className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--color-ink-soft)] underline"
        >
          Retirer
        </button>
      </div>
      {frequence.sources.length === 0 ? null : (
        <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Les assistants ont lu :{' '}
          {frequence.sources.slice(0, 3).map((source, rang) => (
            <span key={source}>
              {rang === 0 ? '' : ', '}
              <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-ink-soft)] underline"
              >
                {new URL(source).hostname.replace(/^www\./u, '')}
              </a>
            </span>
          ))}
        </p>
      )}
    </li>
  )
}

export function VisibiliteIA({
  siteId,
  host,
  initiales,
  plateformes,
  cout,
  jours,
}: {
  siteId: string
  host: string
  initiales: readonly FrequenceVue[]
  /** Les plateformes réellement interrogeables : celles dont la clé est posée. */
  plateformes: readonly string[]
  cout: number
  jours: number
}) {
  const [liste, setListe] = useState<FrequenceVue[]>([...initiales])
  const [texte, setTexte] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [bilan, setBilan] = useState<string | null>(null)

  const actives = liste.filter((ligne) => ligne.prompt.actif).length

  async function appeler(corps: Record<string, unknown>): Promise<unknown> {
    setErreur(null)
    const reponse = await fetch(`/api/sites/${siteId}/visibilite-ia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }).catch(() => null)
    const charge = (await reponse?.json().catch(() => null)) as Record<string, unknown> | null
    if (reponse === null || !reponse.ok) {
      setErreur(
        (charge?.message as string | undefined) ??
          `L’opération n’a pas abouti (code ${reponse?.status ?? 0}).`,
      )
      return null
    }
    return charge
  }

  async function ajouter() {
    const propre = texte.trim()
    if (propre.length < 8) return
    setOccupe(true)
    const charge = (await appeler({ geste: 'ajouter', texte: propre })) as {
      prompt?: FrequenceVue['prompt']
    } | null
    setOccupe(false)
    if (charge?.prompt === undefined) return
    setListe((actuelles) => [
      ...actuelles,
      { prompt: charge.prompt!, releves: 0, mentions: 0, sentiment: 'inconnu', sources: [] },
    ])
    setTexte('')
  }

  async function basculer(promptId: string, actif: boolean) {
    await appeler({ geste: 'basculer', promptId, actif })
    setListe((actuelles) =>
      actuelles.map((ligne) =>
        ligne.prompt.id === promptId ? { ...ligne, prompt: { ...ligne.prompt, actif } } : ligne,
      ),
    )
  }

  async function retirer(promptId: string) {
    await appeler({ geste: 'retirer', promptId })
    setListe((actuelles) => actuelles.filter((ligne) => ligne.prompt.id !== promptId))
  }

  async function relever() {
    setOccupe(true)
    setBilan(null)
    const charge = (await appeler({ geste: 'relever' })) as {
      bilan?: { questions: number; releves: number; mentions: number; credits: number }
    } | null
    setOccupe(false)
    if (charge?.bilan === undefined) return
    const { questions, releves, mentions, credits } = charge.bilan
    setBilan(
      `${questions} question${questions > 1 ? 's' : ''} posée${questions > 1 ? 's' : ''}, ` +
        `${releves} relevé${releves > 1 ? 's' : ''}, ${mentions} mention${mentions > 1 ? 's' : ''}. ` +
        `${credits} crédit${credits > 1 ? 's' : ''} débité${credits > 1 ? 's' : ''}. Rechargez pour voir le détail.`,
    )
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed">
          Evoliia pose vos questions à{' '}
          <strong>{plateformes.map((nom) => PLATEFORMES[nom] ?? nom).join(', ')}</strong> comme le
          ferait un client, et regarde si <strong>{host}</strong> apparaît dans la réponse.
        </p>
        {/*
          La limite, dite avant qu'on la découvre. Ces deux-là ne sont pas mesurables
          honnêtement, et les afficher en mesurant autre chose serait exactement ce que ce
          produit refuse de faire.
        */}
        <p className="mt-3 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          <strong>ChatGPT et les encadrés IA de Google ne sont pas mesurés.</strong> ChatGPT
          n’expose aucune interface qui reproduise ce que voit son utilisateur, et les
          encadrés de Google n’en ont aucune du tout : les afficher demanderait d’aspirer des
          pages de résultats, ce qu’Evoliia ne fera pas. Trois plateformes mesurées valent
          mieux que cinq annoncées.
        </p>
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <label className="block">
          <span className="text-sm font-medium">
            Une question qu’un client pourrait poser à une IA
          </span>
          <input
            type="text"
            value={texte}
            maxLength={300}
            onChange={(event) => setTexte(event.target.value)}
            placeholder="Quelle bougie naturelle offrir pour un anniversaire ?"
            className="mt-1.5 w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm"
          />
          <span className="mt-1.5 block text-xs text-[var(--color-ink-faint)]">
            Écrivez-la dans la langue de vos clients. Une question où votre marque devrait
            apparaître, pas une question sur votre marque — « quelle bougie offrir » vaut
            mieux que « que fait {host} ».
          </span>
        </label>
        <button
          type="button"
          onClick={() => void ajouter()}
          disabled={occupe || texte.trim().length < 8}
          className="mt-3 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
        >
          Ajouter cette question
        </button>
      </section>

      {liste.length === 0 ? null : (
        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="m-0 text-base font-semibold">
              Vos questions ({actives} posée{actives > 1 ? 's' : ''})
            </h2>
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">
              Fréquences sur les {jours} derniers jours
            </p>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0">
            {liste.map((frequence) => (
              <Ligne
                key={frequence.prompt.id}
                frequence={frequence}
                onBasculer={(actif) => void basculer(frequence.prompt.id, actif)}
                onRetirer={() => void retirer(frequence.prompt.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <button
          type="button"
          onClick={() => void relever()}
          disabled={occupe || actives === 0}
          className="cursor-pointer rounded-[var(--radius-pill)] border-0 bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {occupe
            ? 'Evoliia interroge les assistants…'
            : `Poser les ${actives} question${actives > 1 ? 's' : ''} (${actives * cout} crédits)`}
        </button>
        <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Chaque question est posée plusieurs fois à chaque assistant : leurs réponses ne sont
          pas identiques d’une fois sur l’autre, et une seule lecture ne prouverait rien — ni
          la présence, ni l’absence. Vous n’êtes facturé qu’une fois par question, quel que
          soit le nombre d’interrogations. Un assistant injoignable n’est pas facturé.
        </p>
        {occupe ? (
          <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
            Cela prend une à plusieurs minutes. Laissez cette page ouverte.
          </p>
        ) : null}
        {bilan === null ? null : (
          <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">{bilan}</p>
        )}
        {erreur === null ? null : (
          <p className="mt-3 mb-0 text-sm text-[var(--color-danger,#b42318)]">{erreur}</p>
        )}
        <p className="mt-4 mb-0 border-t border-[var(--color-line)] pt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Ce chiffre est une fréquence observée, pas un état. Aucune action ne garantit
          l’apparition d’une marque dans un assistant, et rien ici ne le promet.
        </p>
      </section>
    </div>
  )
}
