'use client'

import { useState } from 'react'
import { membre } from '@/lib/equipe'

/**
 * « Demander à Cleo », sur une priorité.
 *
 * Oria a préparé la question ; la personne choisit à qui la transmettre, et clique. Le
 * prix est sur le bouton : une délégation est une question à un spécialiste, et elle coûte
 * ce qu'une question coûte. Rien ne part sans ce clic.
 *
 * La réponse s'affiche sur place, repliable, avec un lien vers la conversation du
 * spécialiste — c'est là qu'on la retrouve, et qu'on peut continuer.
 */

type Destinataire = { agent: string; pour: string }
type Note = { agent: string; agentName: string; answer: string; creditsSpent: number }

export function DelegationOria({
  cle,
  siteId,
  locale,
  destinataires,
  cout,
  versConversation,
}: {
  cle: string
  siteId: string
  locale: string
  destinataires: readonly Destinataire[]
  cout: { min: number; max: number } | null
  /** L'adresse de la conversation d'un agent, sans l'identifiant d'agent. */
  versConversation: string
}) {
  const [occupe, setOccupe] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const prix =
    cout === null ? '' : cout.min === cout.max ? ` · ${cout.min} crédits` : ` · ${cout.min} à ${cout.max} crédits`

  async function transmettre(agent: string) {
    setOccupe(agent)
    setErreur(null)
    const reponse = await fetch('/api/oria/deleguer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cle, agent, siteId, locale }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { note?: Note; message?: string } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok || corps?.note === undefined) {
      setErreur(corps?.message ?? `La transmission n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setNote(corps.note)
  }

  if (destinataires.length === 0) return null

  return (
    <div className="mt-3">
      {note === null ? (
        <div className="flex flex-wrap gap-2">
          {destinataires.map((destinataire) => {
            const qui = membre(destinataire.agent)
            return (
              <button
                key={destinataire.agent}
                type="button"
                disabled={occupe !== null}
                onClick={() => transmettre(destinataire.agent)}
                className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface)] py-1 pr-3 pl-1 text-xs hover:border-[var(--color-brand)] disabled:opacity-50"
                title={`Oria transmet ce point à ${qui?.name ?? destinataire.agent} pour ${destinataire.pour}${prix}`}
              >
                {qui?.avatar === undefined ? null : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qui.avatar} alt="" width={20} height={20} className="h-5 w-5 rounded-full object-cover" />
                )}
                {occupe === destinataire.agent
                  ? `${qui?.name ?? destinataire.agent} réfléchit…`
                  : `Demander à ${qui?.name ?? destinataire.agent} de ${destinataire.pour}`}
              </button>
            )
          })}
          {prix === '' ? null : (
            <span className="self-center text-[11px] text-[var(--color-ink-faint)]">{prix.replace(' · ', '')} par question</span>
          )}
        </div>
      ) : (
        <details open className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {note.agentName} a répondu
          </summary>
          <p className="mt-2 mb-0 text-sm leading-relaxed whitespace-pre-line">{note.answer}</p>
          <a href={`${versConversation}${note.agent}`} className="mt-2 inline-block text-xs">
            Continuer avec {note.agentName}
          </a>
        </details>
      )}
      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm" style={{ color: 'var(--color-critical)' }}>
          {erreur}
        </p>
      )}
    </div>
  )
}
