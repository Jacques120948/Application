'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Le mode assisté, côté écran : Lina dit exactement ce qu'elle va faire, la personne confirme,
 * Lina exécute. Rien ne se passe au premier clic.
 */
export function CreerSegmentLina({ type, cle, nom }: { type: 'segment' | 'campagne'; cle: string; nom: string }) {
  const [etape, setEtape] = useState<'repos' | 'confirmer' | 'envoi' | 'ok' | 'erreur'>('repos')
  const [message, setMessage] = useState('')
  const [lien, setLien] = useState('')

  async function executer() {
    setEtape('envoi')
    const reponse = await fetch('/api/lina/executer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, cle }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { nom?: string; lien?: string; message?: string } | null
    if (reponse === null || !reponse.ok) {
      setEtape('erreur')
      setMessage(corps?.message ?? 'Le segment n’a pas pu être créé.')
      return
    }
    setEtape('ok')
    setMessage(corps?.nom ?? '')
    setLien(corps?.lien ?? '')
  }

  if (etape === 'ok') {
    return (
      <p className="m-0 text-xs text-[var(--color-positive)]">
        Segment « {message} » créé dans Shopify.{' '}
        {lien === '' ? null : (
          <a href={lien} target="_blank" rel="noopener noreferrer">
            Le voir ↗
          </a>
        )}
      </p>
    )
  }
  if (etape === 'confirmer' || etape === 'envoi') {
    return (
      <div className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] p-3 text-xs leading-relaxed">
        <p className="m-0">
          Lina va créer dans votre boutique Shopify le segment « Lina — {nom} ». Aucune fiche client n’est modifiée, aucun
          email n’est envoyé : vous déciderez ensuite quoi en faire.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={etape === 'envoi'} onClick={() => void executer()} className="px-2 py-1 text-xs">
            Confirmer
          </Button>
          <Button type="button" variant="ghost" disabled={etape === 'envoi'} onClick={() => setEtape('repos')} className="px-2 py-1 text-xs">
            Annuler
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-1">
      <Button type="button" variant="ghost" onClick={() => setEtape('confirmer')} className="justify-self-start px-2 py-1 text-xs">
        Créer ce segment dans Shopify
      </Button>
      {etape === 'erreur' ? <span className="text-xs leading-relaxed text-[var(--color-critical)]">{message}</span> : null}
    </div>
  )
}

export function AutonomieLina({ niveau }: { niveau: 'conseil' | 'assiste' }) {
  const router = useRouter()
  const [choix, setChoix] = useState(niveau)
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')

  async function enregistrer(valeur: 'conseil' | 'assiste') {
    setChoix(valeur)
    setEtat('envoi')
    const reponse = await fetch('/api/lina/autonomie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ niveau: valeur }),
    }).catch(() => null)
    setEtat(reponse?.ok === true ? 'ok' : 'erreur')
    router.refresh()
  }

  const options = [
    { valeur: 'conseil' as const, titre: 'Conseil', texte: 'Lina recommande et prépare. Vous faites tout vous-même dans vos outils.' },
    { valeur: 'assiste' as const, titre: 'Assisté', texte: 'Lina recommande ; quand vous validez, elle crée le segment dans Shopify. Rien d’autre, et jamais d’envoi.' },
  ]
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 text-xs text-[var(--color-ink-soft)]">
        Il n’y a pas de niveau « automatique » : Lina n’exécute rien que vous n’ayez validé.
      </legend>
      {options.map((option) => (
        <label key={option.valeur} className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="autonomie" checked={choix === option.valeur} disabled={etat === 'envoi'} onChange={() => void enregistrer(option.valeur)} className="mt-1" />
          <span>
            <strong>{option.titre}</strong>
            <span className="block text-xs text-[var(--color-ink-soft)]">{option.texte}</span>
          </span>
        </label>
      ))}
      {etat === 'ok' ? <span className="text-xs text-[var(--color-positive)]">Enregistré.</span> : null}
      {etat === 'erreur' ? <span className="text-xs text-[var(--color-critical)]">Ce réglage n’a pas pu être enregistré.</span> : null}
    </fieldset>
  )
}

/** Recevoir le bilan de la semaine par e-mail, le lundi. Éteint tant que la personne ne l'a pas demandé. */
export function BilanEmailLina({ actif, disponible }: { actif: boolean; disponible: boolean }) {
  const [coche, setCoche] = useState(actif)
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')

  async function changer(valeur: boolean) {
    setCoche(valeur)
    setEtat('envoi')
    const reponse = await fetch('/api/lina/bilan-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actif: valeur }),
    }).catch(() => null)
    if (reponse?.ok === true) {
      setEtat('ok')
    } else {
      setCoche(!valeur)
      setEtat('erreur')
    }
  }

  return (
    <div className="grid gap-1 text-sm">
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={coche} disabled={!disponible || etat === 'envoi'} onChange={(e) => void changer(e.target.checked)} className="mt-1" />
        <span>
          Recevoir le bilan par e-mail, chaque lundi
          <span className="block text-xs text-[var(--color-ink-soft)]">
            {disponible
              ? 'Les mêmes chiffres qu’ici, à l’adresse de votre compte. Aucun client n’y est nommé.'
              : 'L’envoi d’e-mails n’est pas encore ouvert sur Evoliia.'}
          </span>
        </span>
      </label>
      {etat === 'ok' ? <span className="text-xs text-[var(--color-positive)]">{coche ? 'C’est noté : prochain bilan lundi.' : 'Vous ne recevrez plus le bilan par e-mail.'}</span> : null}
      {etat === 'erreur' ? <span className="text-xs text-[var(--color-critical)]">Ce réglage n’a pas pu être enregistré.</span> : null}
    </div>
  )
}
