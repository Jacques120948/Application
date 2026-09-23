'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Saisir les résultats d'une campagne. Les nombres viennent de l'outil d'envoi (Shopify
 * Email, Klaviyo, Brevo…) ; Lina en tire les taux et, pour deux variantes d'un même test,
 * dit s'il y a un gagnant.
 */

type Champ = 'nom' | 'type' | 'groupe' | 'variante' | 'envoyeLe' | 'envoyes' | 'ouvertures' | 'clics' | 'conversions' | 'ca' | 'desinscriptions'

const VIDE: Record<Champ, string> = {
  nom: '',
  type: 'autre',
  groupe: '',
  variante: '',
  envoyeLe: '',
  envoyes: '',
  ouvertures: '',
  clics: '',
  conversions: '',
  ca: '',
  desinscriptions: '',
}

export function SaisieResultatLina({ campagnes }: { campagnes: readonly { cle: string; titre: string }[] }) {
  const router = useRouter()
  const [valeurs, setValeurs] = useState(VIDE)
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')
  const [message, setMessage] = useState('')
  const changer = (champ: Champ) => (evenement: { target: { value: string } }) => setValeurs({ ...valeurs, [champ]: evenement.target.value })
  const nombre = (texte: string) => (texte.trim() === '' ? null : Math.round(Number(texte)))

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault()
    setEtat('envoi')
    const reponse = await fetch('/api/lina/resultats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nom: valeurs.nom,
        type: valeurs.type,
        groupe: valeurs.groupe,
        variante: valeurs.variante,
        envoyeLe: valeurs.envoyeLe === '' ? null : valeurs.envoyeLe,
        envoyes: nombre(valeurs.envoyes) ?? 0,
        ouvertures: nombre(valeurs.ouvertures),
        clics: nombre(valeurs.clics),
        conversions: nombre(valeurs.conversions) ?? 0,
        caCents: Math.round(Number(valeurs.ca || '0') * 100),
        desinscriptions: nombre(valeurs.desinscriptions),
      }),
    }).catch(() => null)
    if (reponse === null || !reponse.ok) {
      const detail = (await reponse?.json().catch(() => null)) as { message?: string } | null
      setEtat('erreur')
      setMessage(detail?.message ?? 'Ce résultat n’a pas pu être enregistré.')
      return
    }
    setEtat('ok')
    setValeurs(VIDE)
    router.refresh()
  }

  const champ = 'w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm'
  const nombreChamp = (cle: Champ, label: string, requis = false) => (
    <label className="grid min-w-0 gap-1 text-xs">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={0} step={cle === 'ca' ? 0.01 : 1} required={requis} value={valeurs[cle]} onChange={changer(cle)} className={`${champ} w-full tabular-nums`} />
    </label>
  )
  return (
    <form onSubmit={(evenement) => void enregistrer(evenement)} className="grid gap-3">
      <label className="grid min-w-0 gap-1 text-xs">
        <span>Nom de l’envoi</span>
        <input required maxLength={120} value={valeurs.nom} onChange={changer('nom')} className={champ} placeholder="Réactivation septembre" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs">
          <span>Campagne de Lina</span>
          <select value={valeurs.type} onChange={changer('type')} className={champ}>
            <option value="autre">Autre</option>
            {campagnes.map((campagne) => (
              <option key={campagne.cle} value={campagne.cle.slice(0, 60)}>
                {campagne.titre}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          <span>Date d’envoi</span>
          <input type="date" value={valeurs.envoyeLe} onChange={changer('envoyeLe')} className={champ} />
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          <span>Test A/B (nom du test, facultatif)</span>
          <input maxLength={60} value={valeurs.groupe} onChange={changer('groupe')} className={champ} placeholder="Objet septembre" />
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          <span>Variante</span>
          <select value={valeurs.variante} onChange={changer('variante')} className={champ}>
            <option value="">Aucune</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {nombreChamp('envoyes', 'Emails envoyés', true)}
        {nombreChamp('ouvertures', 'Ouvertures')}
        {nombreChamp('clics', 'Clics')}
        {nombreChamp('conversions', 'Commandes', true)}
        {nombreChamp('ca', 'Chiffre d’affaires', true)}
        {nombreChamp('desinscriptions', 'Désinscriptions')}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={etat === 'envoi'}>
          Enregistrer
        </Button>
        {etat === 'ok' ? <span className="text-xs text-[var(--color-positive)]">Enregistré.</span> : null}
        {etat === 'erreur' ? <span className="text-xs text-[var(--color-critical)]">{message}</span> : null}
      </div>
    </form>
  )
}

export function SupprimerResultatLina({ id }: { id: string }) {
  const router = useRouter()
  const [occupe, setOccupe] = useState(false)
  return (
    <button
      type="button"
      disabled={occupe}
      onClick={() => {
        setOccupe(true)
        void fetch('/api/lina/resultats', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
          .catch(() => null)
          .finally(() => {
            setOccupe(false)
            router.refresh()
          })
      }}
      className="text-[11px] text-[var(--color-ink-faint)] underline"
    >
      Supprimer
    </button>
  )
}

/**
 * Un résultat relu depuis l'outil d'envoi : l'outil ne sait ni à quelle campagne de Lina il
 * répond, ni s'il fait partie d'un test A/B. La personne le dit ici.
 */
export function ClasserResultatLina({
  id,
  groupe,
  variante,
  type,
  campagnes,
}: {
  id: string
  groupe: string
  variante: '' | 'A' | 'B'
  type: string
  campagnes: readonly { cle: string; titre: string }[]
}) {
  const router = useRouter()
  const [valeurs, setValeurs] = useState({ groupe, variante, type })
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')
  const [message, setMessage] = useState('')

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault()
    setEtat('envoi')
    const reponse = await fetch('/api/lina/resultats', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...valeurs }),
    }).catch(() => null)
    if (reponse === null || !reponse.ok) {
      const detail = (await reponse?.json().catch(() => null)) as { message?: string } | null
      setEtat('erreur')
      setMessage(detail?.message ?? 'Ce classement n’a pas pu être enregistré.')
      return
    }
    setEtat('ok')
    router.refresh()
  }

  const champ = 'w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs'
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-[var(--color-ink-soft)]">Classer (campagne, test A/B)</summary>
      <form onSubmit={(evenement) => void enregistrer(evenement)} className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1">
          <span>Campagne de Lina</span>
          <select value={valeurs.type} onChange={(e) => setValeurs({ ...valeurs, type: e.target.value })} className={champ}>
            <option value="autre">Autre</option>
            {campagnes.map((campagne) => (
              <option key={campagne.cle} value={campagne.cle.slice(0, 60)}>
                {campagne.titre}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span>Nom du test</span>
          <input maxLength={60} value={valeurs.groupe} onChange={(e) => setValeurs({ ...valeurs, groupe: e.target.value })} className={champ} />
        </label>
        <label className="grid min-w-0 gap-1">
          <span>Variante</span>
          <select value={valeurs.variante} onChange={(e) => setValeurs({ ...valeurs, variante: e.target.value as '' | 'A' | 'B' })} className={champ}>
            <option value="">Aucune</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={etat === 'envoi'}>
            Enregistrer
          </Button>
          {etat === 'ok' ? <span className="text-[var(--color-positive)]">Enregistré.</span> : null}
          {etat === 'erreur' ? <span className="text-[var(--color-critical)]">{message}</span> : null}
        </div>
      </form>
    </details>
  )
}
