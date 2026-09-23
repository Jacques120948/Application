'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Quels événements clés de GA4 comptent comme prospects.
 *
 * Nova en propose d'après leur nom ; la personne coche ce qui est vraiment une demande chez
 * elle. « Laisser Nova choisir » rend la main à la reconnaissance par le nom.
 */
export function ProspectsNova({
  disponibles,
  choisis,
  auto,
}: {
  disponibles: readonly { nom: string; total: number }[]
  choisis: readonly string[]
  auto: boolean
}) {
  const router = useRouter()
  const [coches, setCoches] = useState<string[]>([...choisis])
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'erreur'>('repos')
  const [message, setMessage] = useState('')

  async function enregistrer(evenements: string[] | null): Promise<void> {
    setEtat('envoi')
    const reponse = await fetch('/api/nova/prospects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evenements }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => ({}))) as { message?: string }
    if (reponse === null || reponse === undefined || !reponse.ok) {
      setEtat('erreur')
      setMessage(corps?.message ?? 'Le choix n’a pas pu être enregistré.')
      return
    }
    setEtat('repos')
    router.refresh()
  }

  if (disponibles.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">
        Aucun événement clé vu dans Google Analytics sur les 30 derniers jours. Déclarez vos demandes (formulaire envoyé, clic sur
        « Appeler », demande de devis) comme événements clés dans GA4 : Nova pourra les compter.
      </p>
    )
  }
  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs text-[var(--color-ink-soft)]">
        {auto ? 'Choisis par Nova d’après leur nom. Cochez ce qui est vraiment une demande chez vous.' : 'Votre choix.'} L’achat et ses étapes
        ne sont pas proposés : ce ne sont pas des prospects.
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {disponibles.map((evenement) => (
          <li key={evenement.nom}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={coches.includes(evenement.nom)}
                onChange={(e) => setCoches(e.target.checked ? [...coches, evenement.nom].slice(0, 10) : coches.filter((nom) => nom !== evenement.nom))}
              />
              <code className="text-xs">{evenement.nom}</code>
              <span className="text-xs text-[var(--color-ink-faint)]">{new Intl.NumberFormat('fr-CH').format(evenement.total)} sur 30 jours</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button className="px-3 py-1 text-xs" disabled={etat === 'envoi'} onClick={() => void enregistrer(coches)}>
          Enregistrer
        </Button>
        {auto ? null : (
          <Button variant="ghost" className="px-3 py-1 text-xs" disabled={etat === 'envoi'} onClick={() => void enregistrer(null)}>
            Laisser Nova choisir
          </Button>
        )}
      </div>
      {etat === 'erreur' ? <p className="m-0 text-xs text-[var(--color-critical)]">{message}</p> : null}
    </div>
  )
}
