'use client'

import { useState } from 'react'

/**
 * La conversation avec l'équipe.
 *
 * Jusqu'ici l'équipe écrivait et la personne lisait. Ici elle peut demander — et c'est la
 * différence entre un outil qui rend un rapport et quelqu'un à qui l'on parle. Quatre partis
 * pris.
 *
 * **On choisit un interlocuteur, pas un menu de fonctions.** Léa, Néo, Gia, Milo : quatre
 * visages, quatre métiers. « Poser une question sur le référencement » serait plus précis et
 * beaucoup moins naturel ; personne n'écrit à une catégorie.
 *
 * **Les questions d'exemple sont là dès le départ.** Devant un champ vide, on ne sait pas ce
 * qu'on a le droit de demander, et on referme. Trois exemples par spécialiste suffisent à
 * montrer le registre.
 *
 * **Le prix est annoncé avant.** Une question coûte des crédits, l'écran le dit sur le
 * bouton, et le débit réel suit les jetons consommés.
 *
 * **Un spécialiste fermé s'affiche sans se cacher.** On voit ce qu'on n'a pas, et avec
 * quelle offre on l'aurait. Le masquer ferait croire que le produit est plus pauvre qu'il
 * n'est.
 */

export type AgentVu = {
  id: string
  name: string
  role: string
  avatar: string
  summary: string
  starters: string[]
  open: boolean
  availableWith: string | null
}

export type EchangeVu = {
  id: string
  agent: string
  agentName: string
  question: string
  answer: string
  creditsSpent: number
  createdAt: string
}

/** Portrait, avec la pastille à initiale en secours si le fichier manque. */
function Portrait({ agent, taille = 44 }: { agent: AgentVu; taille?: number }) {
  if (agent.avatar === '') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] font-semibold text-[var(--color-brand-strong)]"
        style={{ width: taille, height: taille }}
        aria-hidden="true"
      >
        {agent.name.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={agent.avatar}
      alt=""
      width={taille}
      height={taille}
      className="shrink-0 rounded-full object-cover"
      style={{ width: taille, height: taille }}
    />
  )
}

export function EquipeVisibilite({
  siteId,
  siteHost,
  locale,
  agents,
  echanges,
  cout,
  /** Le membre que le menu demande d'ouvrir. Vide : le premier disponible. */
  demande = '',
}: {
  siteId: string
  siteHost: string
  locale: string
  agents: readonly AgentVu[]
  echanges: readonly EchangeVu[]
  cout: number
  demande?: string
}) {
  /*
   * Le membre demandé l'emporte sur le premier ouvert, mais seulement s'il existe : un
   * identifiant venu de l'adresse ne doit pas laisser l'écran sans interlocuteur.
   */
  const voulu = agents.find((agent) => agent.id === demande)
  const premier = voulu ?? agents.find((agent) => agent.open) ?? agents[0]
  const [choisi, setChoisi] = useState<string>(premier?.id ?? '')
  const [question, setQuestion] = useState('')
  const [fil, setFil] = useState<EchangeVu[]>([...echanges])
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const agent = agents.find((candidat) => candidat.id === choisi) ?? premier
  const duSpecialiste = fil.filter((echange) => echange.agent === choisi)

  async function envoyer() {
    const propre = question.trim()
    if (propre.length < 3 || occupe || agent === undefined || !agent.open) return
    setOccupe(true)
    setErreur(null)

    const response = await fetch(`/api/sites/${siteId}/equipe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: agent.id,
        question: propre,
        locale,
        /*
         * Les deux derniers échanges avec ce spécialiste, et rien de plus : un fil entier
         * coûterait à chaque question ce qu'il a coûté depuis le début.
         */
        history: duSpecialiste.slice(0, 2).map((echange) => ({
          question: echange.question,
          answer: echange.answer,
        })),
      }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as
      | { note?: EchangeVu; message?: string }
      | null
    setOccupe(false)

    if (response === null || !response.ok || body?.note === undefined) {
      setErreur(body?.message ?? 'La question n’a pas abouti. Rien ne vous a été débité.')
      return
    }
    setFil((actuels) => [body.note as EchangeVu, ...actuels])
    setQuestion('')
  }

  if (agent === undefined) return null

  return (
    <div className="grid gap-5">
      {/* Les quatre visages. On choisit quelqu'un, pas une catégorie. */}
      <div className="flex flex-wrap gap-2">
        {agents.map((candidat) => {
          const actif = candidat.id === choisi
          return (
            <button
              key={candidat.id}
              type="button"
              onClick={() => setChoisi(candidat.id)}
              aria-pressed={actif}
              className="inline-flex items-center gap-2.5 rounded-[var(--radius-pill)] border px-3 py-2 text-sm transition"
              style={{
                borderColor: actif ? 'var(--color-brand)' : 'var(--color-line)',
                background: actif ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                color: actif ? 'var(--color-brand-strong)' : 'var(--color-ink-soft)',
                opacity: candidat.open ? 1 : 0.6,
              }}
            >
              <Portrait agent={candidat} taille={26} />
              <span className="font-medium">{candidat.name}</span>
              <span className="text-xs">{candidat.role}</span>
            </button>
          )
        })}
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start gap-4">
          <Portrait agent={agent} taille={48} />
          <div className="min-w-0">
            <h3 className="m-0 text-base font-semibold">
              {agent.name} — {agent.role}
            </h3>
            <p className="mt-1 mb-0 text-sm text-[var(--color-ink-soft)]">{agent.summary}</p>
          </div>
        </div>

        {!agent.open ? (
          /*
            Un spécialiste fermé s'affiche sans se cacher : on voit ce qu'on n'a pas, et avec
            quelle offre on l'aurait. Le masquer ferait croire le produit plus pauvre.
          */
          <p className="mt-4 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
            {/*
              « Léa est ouvert » : la phrase générique se trompe d'accord une fois sur deux.
              On tourne la phrase autour de l'offre, qui n'a pas de genre.
            */}
            {agent.availableWith === null
              ? 'Ce spécialiste ne répond pas sur votre offre.'
              : `${agent.name} répond à partir de l’offre ${agent.availableWith}.`}
          </p>
        ) : (
          <>
            {duSpecialiste.length > 0 ? null : (
              <div className="mt-5">
                <p className="m-0 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
                  On peut lui demander
                </p>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {agent.starters.map((exemple) => (
                    <li key={exemple}>
                      <button
                        type="button"
                        onClick={() => setQuestion(exemple)}
                        className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] transition hover:text-[var(--color-brand-strong)]"
                      >
                        {exemple}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5">
              <label
                htmlFor="question-equipe"
                className="mb-1.5 block text-sm font-medium text-[var(--color-ink)]"
              >
                Votre question à {agent.name}
              </label>
              <textarea
                id="question-equipe"
                rows={3}
                value={question}
                maxLength={600}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={occupe}
                placeholder={`À propos de ${siteHost}…`}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
              />
            </div>

            {erreur === null ? null : (
              <p className="mt-3 mb-0 text-sm text-[var(--color-critical)]">{erreur}</p>
            )}

            <button
              type="button"
              onClick={() => void envoyer()}
              disabled={occupe || question.trim().length < 3}
              className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundImage: 'var(--gradient-cta)' }}
            >
              {occupe ? `${agent.name} réfléchit…` : `Demander à ${agent.name}`}
              <span className="text-xs text-white/70">
                ~{cout} crédit{cout > 1 ? 's' : ''}
              </span>
            </button>
          </>
        )}
      </div>

      {duSpecialiste.length === 0 ? null : (
        <ol className="m-0 grid list-none gap-4 p-0">
          {duSpecialiste.map((echange) => (
            <li
              key={echange.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
            >
              <p className="m-0 text-sm font-medium text-[var(--color-ink)]">{echange.question}</p>
              <div className="mt-3 flex items-start gap-3">
                <Portrait agent={agent} taille={32} />
                <p className="m-0 text-sm leading-relaxed whitespace-pre-line text-[var(--color-ink-soft)]">
                  {echange.answer}
                </p>
              </div>
              <p className="m-0 mt-3 text-xs text-[var(--color-ink-faint)]">
                {echange.creditsSpent} crédit{echange.creditsSpent > 1 ? 's' : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
