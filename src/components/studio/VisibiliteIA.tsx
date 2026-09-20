'use client'

import { useEffect, useState } from 'react'

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

export type EtatVu = { enCours: boolean; attendu: number; fait: number }

export type QuestionProposeeVue = {
  question: string
  theme: string
  langue: string
  fondement: string
}

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
  locale,
  passage,
}: {
  siteId: string
  host: string
  locale: string
  initiales: readonly FrequenceVue[]
  /** Les plateformes réellement interrogeables : celles dont la clé est posée. */
  plateformes: readonly string[]
  cout: number
  jours: number
  /** L'état du passage à l'ouverture de la page : il a pu avancer sans nous. */
  passage: EtatVu
}) {
  const [liste, setListe] = useState<FrequenceVue[]>([...initiales])
  const [texte, setTexte] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [bilan, setBilan] = useState<string | null>(null)
  /*
   * L'avancement du passage en cours.
   *
   * Il existe pour une raison simple : interroger trois assistants sur quatorze questions
   * prend plusieurs minutes, et exiger que la page reste ouverte pendant ce temps est une
   * contrainte que personne n'accepte. Le travail continue côté serveur ; cet écran ne fait
   * que regarder où il en est, et le relancer s'il a été coupé.
   */
  const [etat, setEtat] = useState<EtatVu>(passage)
  /*
   * Les questions proposées, pas encore suivies. Rien n'est enregistré tant que la personne
   * n'a pas choisi : une question qu'elle n'aurait pas retenue serait une mesure qu'elle
   * paierait sans l'avoir décidée.
   */
  const [proposees, setProposees] = useState<QuestionProposeeVue[] | null>(null)

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

  /*
   * Tant qu'un passage tourne, on demande où il en est toutes les dix secondes. Si le
   * serveur a été coupé au milieu — déploiement, fonction arrivée à son terme — le même
   * appel le relance : « reprendre » ne recommence rien, il continue.
   */
  useEffect(() => {
    if (!etat.enCours) return
    const minuteur = setInterval(() => {
      void (async () => {
        const charge = (await appeler({ geste: 'reprendre' })) as { etat?: EtatVu } | null
        if (charge?.etat !== undefined) setEtat(charge.etat)
      })()
    }, 10_000)
    return () => clearInterval(minuteur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat.enCours])

  async function proposer() {
    setOccupe(true)
    const charge = (await appeler({ geste: 'proposer', locale })) as {
      questions?: QuestionProposeeVue[]
    } | null
    setOccupe(false)
    if (charge?.questions === undefined) return
    setProposees(charge.questions)
  }

  /** Une proposition retenue devient une question suivie, et quitte la liste. */
  async function retenir(proposee: QuestionProposeeVue) {
    const charge = (await appeler({
      geste: 'ajouter',
      texte: proposee.question,
      theme: proposee.theme,
    })) as { prompt?: FrequenceVue['prompt'] } | null
    if (charge?.prompt === undefined) return
    setListe((actuelles) => [
      ...actuelles,
      { prompt: charge.prompt!, releves: 0, mentions: 0, sentiment: 'inconnu', sources: [] },
    ])
    setProposees((actuelles) =>
      (actuelles ?? []).filter((autre) => autre.question !== proposee.question),
    )
  }

  async function relever() {
    setOccupe(true)
    setBilan(null)
    const charge = (await appeler({ geste: 'relever' })) as { etat?: EtatVu } | null
    setOccupe(false)
    if (charge?.etat === undefined) return
    setEtat(charge.etat)
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void ajouter()}
            disabled={occupe || texte.trim().length < 8}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
          >
            Ajouter cette question
          </button>
          {/*
            Trouver vingt questions qu'un client poserait à une IA est exactement ce que la
            personne ne sait pas faire — elle connaît son métier, pas les formulations qu'on
            tape dans un assistant. Les matériaux, eux, sont là : ce que les gens ont tapé
            sur Google pour la trouver, et ce que sa boutique vend.
          */}
          <button
            type="button"
            onClick={() => void proposer()}
            disabled={occupe}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
          >
            {occupe ? 'Gia cherche…' : 'Gia me propose des questions (1 crédit)'}
          </button>
        </div>
      </section>

      {proposees === null ? null : (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <p className="m-0 mb-1 text-sm font-medium">
            {proposees.length === 0
              ? 'Gia n’a rien de nouveau à proposer.'
              : `${proposees.length} questions proposées`}
          </p>
          <p className="m-0 mb-4 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            Tirées de ce que les gens tapent réellement sur Google pour vous trouver et de vos
            fiches produits. Aucune n’est suivie tant que vous ne l’ajoutez pas — gardez ce
            qui vous parle, ignorez le reste.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {proposees.map((proposee) => (
              <li
                key={proposee.question}
                className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 text-sm">{proposee.question}</p>
                  <button
                    type="button"
                    onClick={() => void retenir(proposee)}
                    className="cursor-pointer border-0 bg-transparent p-0 text-xs whitespace-nowrap text-[var(--color-brand)] underline"
                  >
                    Ajouter
                  </button>
                </div>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">
                  {proposee.theme === '' ? '' : `${proposee.theme} · `}
                  {proposee.langue.toUpperCase()}
                  {proposee.fondement === '' ? '' : ` · ${proposee.fondement}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        {etat.enCours ? (
          <div className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3">
            <p className="m-0 text-sm font-medium">
              Relevé en cours : {etat.fait} question{etat.fait > 1 ? 's' : ''} sur{' '}
              {etat.attendu}
            </p>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Vous pouvez fermer cette page. Evoliia continue d’interroger les assistants et
              garde chaque réponse au fur et à mesure — revenez quand vous voulez.
            </p>
            <div
              aria-hidden="true"
              className="mt-3 h-1.5 w-full rounded-[var(--radius-pill)] bg-[var(--color-line)]"
            >
              <div
                className="h-1.5 rounded-[var(--radius-pill)] bg-[var(--color-brand)]"
                style={{
                  width: `${etat.attendu === 0 ? 0 : Math.round((etat.fait / etat.attendu) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void relever()}
            disabled={occupe || actives === 0}
            className="cursor-pointer rounded-[var(--radius-pill)] border-0 bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {occupe
              ? 'Evoliia démarre…'
              : `Poser les ${actives} question${actives > 1 ? 's' : ''} (${actives * cout} crédits)`}
          </button>
        )}
        <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Chaque question est posée plusieurs fois à chaque assistant : leurs réponses ne sont
          pas identiques d’une fois sur l’autre, et une seule lecture ne prouverait rien — ni
          la présence, ni l’absence. Vous n’êtes facturé qu’une fois par question, quel que
          soit le nombre d’interrogations. Un assistant injoignable n’est pas facturé.
        </p>
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
