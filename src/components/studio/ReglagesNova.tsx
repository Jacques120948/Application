'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Notice } from '@/components/ui'

type Valeurs = Record<string, string>

type Champ = { cle: string; label: string; aide: string; unite: string; entier?: boolean }

const OBJECTIFS: Champ[] = [
  { cle: 'caMensuel', label: 'Chiffre d’affaires mensuel', aide: 'Ce que vous visez sur un mois.', unite: 'devise' },
  { cle: 'commandesMensuelles', label: 'Commandes par mois', aide: '', unite: '', entier: true },
  { cle: 'roasMin', label: 'ROAS minimum', aide: 'En pour cent : 300 % = 3 francs rapportés pour 1 dépensé.', unite: '%' },
  { cle: 'cacMax', label: 'CAC maximum', aide: 'Ce qu’un nouveau client peut vous coûter au plus.', unite: 'devise' },
]

const COUTS: Champ[] = [
  { cle: 'coutProduitPct', label: 'Coût des produits', aide: 'En pour cent de vos ventes : achat, matières, fabrication. Utilisé seulement si le « Coût par article » de vos fiches Shopify manque.', unite: '%' },
  { cle: 'livraisonParCommande', label: 'Livraison, par commande', aide: 'Ce que vous paie réellement une expédition.', unite: 'devise' },
  { cle: 'paiementPct', label: 'Frais de paiement', aide: 'La part prélevée par Shopify Payments, Stripe, TWINT…', unite: '%' },
  { cle: 'paiementFixe', label: 'Frais fixes par paiement', aide: '', unite: 'devise' },
  { cle: 'commissionPct', label: 'Commissions', aide: 'Places de marché, affiliés.', unite: '%' },
  { cle: 'autresPct', label: 'Autres coûts variables', aide: 'Emballage, cadeaux, retours…', unite: '%' },
]

function enTexte(valeur: number | undefined): string {
  return valeur === undefined ? '' : String(valeur)
}

/**
 * Ce que la personne dit de son activité à Nova.
 *
 * Tout est facultatif, et un champ vide veut dire « je ne sais pas » — jamais zéro. C'est
 * ce qui permet à Nova de dire « frais de paiement non renseignés » plutôt que de calculer
 * une marge qui les oublie en silence.
 */
export function ReglagesNova({
  devise,
  initial,
}: {
  devise: string
  initial: { activite: string; objectifs: Record<string, number | undefined>; couts: Record<string, number | undefined> }
}) {
  const router = useRouter()
  const [activite, setActivite] = useState(initial.activite)
  const [objectifs, setObjectifs] = useState<Valeurs>(
    Object.fromEntries(OBJECTIFS.map((champ) => [champ.cle, enTexte(initial.objectifs[champ.cle])])),
  )
  const [couts, setCouts] = useState<Valeurs>(Object.fromEntries(COUTS.map((champ) => [champ.cle, enTexte(initial.couts[champ.cle])])))
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')
  const [message, setMessage] = useState('')

  function lire(valeurs: Valeurs, champs: Champ[]): Record<string, number> {
    const sortie: Record<string, number> = {}
    for (const champ of champs) {
      const brut = (valeurs[champ.cle] ?? '').trim().replace(',', '.').replace(/[’'\s]/gu, '')
      if (brut === '') continue
      const nombre = Number(brut)
      if (Number.isFinite(nombre)) sortie[champ.cle] = champ.entier === true ? Math.round(nombre) : nombre
    }
    return sortie
  }

  async function enregistrer(): Promise<void> {
    setEtat('envoi')
    setMessage('')
    try {
      const reponse = await fetch('/api/nova/reglages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activite, objectifs: lire(objectifs, OBJECTIFS), couts: lire(couts, COUTS) }),
      })
      const corps = (await reponse.json().catch(() => ({}))) as { message?: string }
      if (!reponse.ok) {
        setEtat('erreur')
        setMessage(corps.message ?? 'Ces réglages n’ont pas pu être enregistrés. Vérifiez les montants et les pourcentages.')
        return
      }
      setEtat('ok')
      router.refresh()
    } catch {
      setEtat('erreur')
      setMessage('Ces réglages n’ont pas pu être enregistrés.')
    }
  }

  const champ = (valeurs: Valeurs, changer: (v: Valeurs) => void, def: Champ) => (
    <label key={def.cle} className="grid gap-1 text-sm">
      <span className="font-medium">{def.label}</span>
      <span className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={valeurs[def.cle] ?? ''}
          onChange={(evenement) => changer({ ...valeurs, [def.cle]: evenement.target.value })}
          placeholder="Non renseigné"
          className="w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        />
        <span className="w-10 shrink-0 text-xs text-[var(--color-ink-soft)]">{def.unite === 'devise' ? devise : def.unite}</span>
      </span>
      {def.aide === '' ? null : <span className="text-xs text-[var(--color-ink-faint)]">{def.aide}</span>}
    </label>
  )

  return (
    <div className="grid gap-6">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Votre activité</span>
        <select
          value={activite}
          onChange={(evenement) => setActivite(evenement.target.value)}
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        >
          <option value="">Non précisée</option>
          <option value="ecommerce">Boutique en ligne</option>
          <option value="services">Prestations de services</option>
          <option value="saas">Abonnement en ligne (SaaS)</option>
        </select>
        <span className="text-xs text-[var(--color-ink-faint)]">Elle décide des chiffres que Nova met en avant.</span>
      </label>

      <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Mes objectifs</legend>
        {OBJECTIFS.map((def) => champ(objectifs, setObjectifs, def))}
      </fieldset>

      <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Mes coûts variables, pour la marge</legend>
        {COUTS.map((def) => champ(couts, setCouts, def))}
      </fieldset>

      {etat === 'erreur' ? <Notice tone="critical">{message}</Notice> : null}
      {etat === 'ok' ? <Notice tone="positive">Enregistré. Nova recalcule avec ces valeurs.</Notice> : null}
      <div>
        <Button disabled={etat === 'envoi'} onClick={() => void enregistrer()}>
          {etat === 'envoi' ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}
