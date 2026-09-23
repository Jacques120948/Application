'use client'

import { useState } from 'react'
import { membre } from '@/lib/equipe'
import { Button, Card, CardBody } from '@/components/ui'

/**
 * La synthèse et l'analyse approfondie de Nova : les deux seuls endroits de Nova qui coûtent.
 *
 * Le prix est sur le bouton, et rien ne part sans clic. Le dernier écrit reste affiché, avec
 * sa date et ce qu'il a coûté : le relire est gratuit.
 */

type Priorite = { titre: string; pourquoi: string; chiffre: string; agent: string }
export type EcritVu =
  | { genre: 'synthese'; contenu: { phrases: string[] }; periode: string; createdAt: string; creditsSpent: number }
  | {
      genre: 'approfondie'
      contenu: { diagnostic: string; priorites: Priorite[]; risques: string[]; aVerifier: string[] }
      periode: string
      createdAt: string
      creditsSpent: number
    }

const LIBELLES = { synthese: 'Synthèse', approfondie: 'Analyse approfondie' } as const

export function EcritsNova({
  derniers,
  couts,
  contexte,
}: {
  derniers: readonly EcritVu[]
  couts: Record<'synthese' | 'approfondie', { min: number; max: number }>
  /** La période affichée et le site : le serveur relit tout lui-même. */
  contexte: Record<string, string>
}) {
  const [ecrit, setEcrit] = useState<EcritVu | null>(derniers[0] ?? null)
  const [occupe, setOccupe] = useState<'synthese' | 'approfondie' | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function demander(genre: 'synthese' | 'approfondie') {
    setOccupe(genre)
    setErreur(null)
    const reponse = await fetch('/api/nova/ecrit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...contexte, genre }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { ecrit?: EcritVu; message?: string } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok || corps?.ecrit === undefined) {
      setErreur(corps?.message ?? `Nova n’a pas pu écrire (code ${reponse?.status ?? 0}).`)
      return
    }
    setEcrit({ ...corps.ecrit, createdAt: String(corps.ecrit.createdAt) })
  }

  const prix = (genre: 'synthese' | 'approfondie') => `${couts[genre].min} à ${couts[genre].max} crédits`
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Nova écrit pour vous</h2>
        <p className="mt-1 mb-3 text-xs text-[var(--color-ink-soft)]">
          Tout l’écran est gratuit. Ces deux écrits appellent l’IA, sur les chiffres déjà calculés : elle explique, elle ne compte rien. La synthèse
          utilise un modèle économique, l’analyse approfondie un modèle de raisonnement.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="px-3 py-1.5 text-sm" disabled={occupe !== null} onClick={() => void demander('synthese')}>
            {occupe === 'synthese' ? 'Nova écrit…' : `Synthèse · ${prix('synthese')}`}
          </Button>
          <Button className="px-3 py-1.5 text-sm" disabled={occupe !== null} onClick={() => void demander('approfondie')}>
            {occupe === 'approfondie' ? 'Nova analyse…' : `Analyse approfondie · ${prix('approfondie')}`}
          </Button>
        </div>
        {erreur === null ? null : (
          <p role="alert" className="mt-2 mb-0 text-sm" style={{ color: 'var(--color-critical)' }}>
            {erreur}
          </p>
        )}
        {ecrit === null ? null : (
          <div className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-4">
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">
              {LIBELLES[ecrit.genre]} · {ecrit.periode} · {new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ecrit.createdAt))} ·{' '}
              {ecrit.creditsSpent} crédit{ecrit.creditsSpent > 1 ? 's' : ''}
            </p>
            {ecrit.genre === 'synthese' ? (
              <div className="mt-2 grid gap-2 text-sm leading-relaxed">
                {ecrit.contenu.phrases.map((phrase) => (
                  <p key={phrase} className="m-0">
                    {phrase}
                  </p>
                ))}
              </div>
            ) : (
              <div className="mt-2 grid gap-3 text-sm leading-relaxed">
                <p className="m-0">{ecrit.contenu.diagnostic}</p>
                <ol className="m-0 grid list-decimal gap-2 pl-5">
                  {ecrit.contenu.priorites.map((priorite) => {
                    const qui = membre(priorite.agent)
                    return (
                      <li key={priorite.titre}>
                        <strong>{priorite.titre}</strong> — {priorite.pourquoi}
                        <span className="block text-xs text-[var(--color-ink-soft)]">
                          Chiffre : {priorite.chiffre} · Qui peut agir : {qui?.name ?? priorite.agent}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                {ecrit.contenu.risques.length === 0 ? null : (
                  <div>
                    <p className="m-0 text-xs font-semibold">Risques</p>
                    <ul className="m-0 mt-1 grid list-disc gap-1 pl-5 text-sm">
                      {ecrit.contenu.risques.map((risque) => (
                        <li key={risque}>{risque}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {ecrit.contenu.aVerifier.length === 0 ? null : (
                  <div>
                    <p className="m-0 text-xs font-semibold">À vérifier avant de décider</p>
                    <ul className="m-0 mt-1 grid list-disc gap-1 pl-5 text-sm">
                      {ecrit.contenu.aVerifier.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
