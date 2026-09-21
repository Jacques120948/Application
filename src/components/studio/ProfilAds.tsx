'use client'

import { useState } from 'react'
import { seuilRentabilite } from '@/lib/rentabilite'
import { Button, Field, Input, Select, Textarea } from '@/components/ui'

/**
 * Ce que la personne vise, saisi par elle.
 *
 * C'est le seul endroit d'Evoliia où l'on demande un chiffre que personne d'autre ne
 * connaît. Google sait ce que la publicité a coûté et ce qu'elle a fait vendre ; il ne sait
 * pas ce qu'il reste au commerçant une fois la bougie fabriquée, emballée et expédiée. Sans
 * cette marge, aucun verdict de rentabilité n'est possible — et en inventer une moyenne de
 * marché reviendrait à décider du budget de quelqu'un à partir d'un chiffre trouvé ailleurs.
 *
 * Trois partis pris.
 *
 * **La marge est le premier champ, et elle porte son effet.** Le seuil de rentabilité
 * s'affiche pendant la frappe : on voit immédiatement qu'une marge de 20 % impose un ROAS de
 * 500 %, et cette phrase-là vaut mieux que n'importe quelle explication préalable.
 *
 * **Un champ vide reste vide.** Aucune valeur par défaut n'est suggérée : une cible
 * pré-remplie serait acceptée sans y penser, et Naya raisonnerait ensuite sur un objectif
 * que personne n'a choisi.
 *
 * **La virgule est acceptée.** On écrit 45,50 en Suisse romande, et refuser la virgule dans
 * un champ de montant est une façon de faire passer l'utilisateur pour fautif.
 */

export type ProfilVu = {
  activite: string
  pays: string
  produits: string
  panierMoyen: number
  margePourcent: number
  roasCible: number
  cpaCible: number
  budgetMensuel: number
  objectif: 'conversions' | 'valeur' | 'roas' | 'cpa'
}

const OBJECTIFS: ReadonlyArray<{ valeur: ProfilVu['objectif']; texte: string }> = [
  { valeur: 'conversions', texte: 'Obtenir le plus de ventes possible' },
  { valeur: 'valeur', texte: 'Obtenir le plus gros chiffre d’affaires' },
  { valeur: 'roas', texte: 'Maximiser le retour sur chaque franc dépensé' },
  { valeur: 'cpa', texte: 'Payer le moins cher possible par vente' },
]

/** Le texte d'un champ numérique. Vide plutôt que « 0 » : zéro veut dire non renseigné. */
function texte(valeur: number): string {
  return valeur === 0 ? '' : String(valeur)
}

/** Un montant tapé à la main vers un nombre. La virgule vaut le point, le vide vaut zéro. */
function nombre(saisi: string): number {
  const propre = saisi.replace(',', '.').trim()
  if (propre === '') return 0
  const lu = Number(propre)
  return Number.isFinite(lu) && lu >= 0 ? lu : 0
}

export function ProfilAds({
  initial,
  devise,
  ouvert,
}: {
  initial: ProfilVu
  devise: string
  /** Ouvert d'office tant que rien n'est renseigné : c'est la question de la page. */
  ouvert: boolean
}) {
  const [profil, setProfil] = useState<ProfilVu>(initial)
  const [marge, setMarge] = useState(texte(initial.margePourcent))
  const [panier, setPanier] = useState(texte(initial.panierMoyen))
  const [roas, setRoas] = useState(texte(initial.roasCible))
  const [cpa, setCpa] = useState(texte(initial.cpaCible))
  const [budget, setBudget] = useState(texte(initial.budgetMensuel))
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enregistre, setEnregistre] = useState(false)

  const seuil = seuilRentabilite(nombre(marge))

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault()
    setEnvoi(true)
    setErreur(null)
    setEnregistre(false)

    const corpsEnvoye = {
      ...profil,
      margePourcent: Math.round(nombre(marge)),
      panierMoyen: nombre(panier),
      roasCible: Math.round(nombre(roas)),
      cpaCible: nombre(cpa),
      budgetMensuel: nombre(budget),
    }

    const reponse = await fetch('/api/ads/profil', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpsEnvoye),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setEnvoi(false)

    if (reponse === null || !reponse.ok) {
      setErreur(
        corps?.message ?? `L’enregistrement n’a pas abouti (code ${reponse?.status ?? 0}).`,
      )
      return
    }
    setEnregistre(true)
    /*
     * La page est rendue côté serveur : le verdict, le seuil et le rythme de budget sont
     * calculés là-bas. Les recalculer ici donnerait deux vérités à l'écran le temps d'un
     * rafraîchissement, et c'est exactement le genre d'écart qu'on ne remarque pas.
     */
    window.location.reload()
  }

  return (
    <details open={ouvert} id="profil" className="scroll-mt-6">
      <summary className="cursor-pointer text-base font-semibold">
        Votre marge et vos objectifs
      </summary>

      <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Google sait ce que votre publicité a coûté et ce qu’elle a fait vendre. Il ne sait pas
        ce qu’il vous reste une fois le produit fabriqué, emballé et expédié — et c’est ce
        chiffre-là qui décide si une campagne vaut la peine. Rien de ce que vous écrivez ici
        n’est envoyé à Google.
      </p>

      <form onSubmit={(evenement) => void enregistrer(evenement)} className="mt-5 grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Marge brute moyenne (%)"
            hint={
              seuil === null
                ? 'Sur 100 francs de vente, ce qu’il vous reste une fois le produit payé.'
                : `Il vous faut donc un ROAS de ${seuil} % pour rentrer dans vos frais.`
            }
          >
            <Input
              type="text"
              inputMode="decimal"
              value={marge}
              onChange={(evenement) => setMarge(evenement.target.value)}
              placeholder="40"
            />
          </Field>

          <Field
            label={`Panier moyen (${devise})`}
            hint="Ce qu’un client dépense en moyenne chez vous, toutes commandes confondues."
          >
            <Input
              type="text"
              inputMode="decimal"
              value={panier}
              onChange={(evenement) => setPanier(evenement.target.value)}
              placeholder="65"
            />
          </Field>

          <Field
            label="ROAS visé (%)"
            hint="Laissez vide si vous n’avez pas d’objectif chiffré : Naya s’en tiendra au seuil."
          >
            <Input
              type="text"
              inputMode="decimal"
              value={roas}
              onChange={(evenement) => setRoas(evenement.target.value)}
              placeholder={seuil === null ? '300' : String(Math.round(seuil * 1.4))}
            />
          </Field>

          <Field
            label={`Coût par vente accepté (${devise})`}
            hint="Le maximum que vous acceptez de payer en publicité pour une commande."
          >
            <Input
              type="text"
              inputMode="decimal"
              value={cpa}
              onChange={(evenement) => setCpa(evenement.target.value)}
              placeholder="25"
            />
          </Field>

          <Field
            label={`Budget publicitaire mensuel (${devise})`}
            hint="Sert à suivre votre rythme de dépense. Evoliia ne modifie aucun budget."
          >
            <Input
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={(evenement) => setBudget(evenement.target.value)}
              placeholder="400"
            />
          </Field>

          <Field label="Ce que vous cherchez avant tout">
            <Select
              value={profil.objectif}
              onChange={(evenement) =>
                setProfil((actuel) => ({
                  ...actuel,
                  objectif: evenement.target.value as ProfilVu['objectif'],
                }))
              }
            >
              {OBJECTIFS.map((choix) => (
                <option key={choix.valeur} value={choix.valeur}>
                  {choix.texte}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Votre activité" hint="En quelques mots, ce que fait votre entreprise.">
            <Input
              type="text"
              value={profil.activite}
              maxLength={120}
              onChange={(evenement) =>
                setProfil((actuel) => ({ ...actuel, activite: evenement.target.value }))
              }
              placeholder="Bougies artisanales aux pierres semi-précieuses"
            />
          </Field>

          <Field label="Où vous vendez" hint="Les pays ou régions que vous livrez.">
            <Input
              type="text"
              value={profil.pays}
              maxLength={60}
              onChange={(evenement) =>
                setProfil((actuel) => ({ ...actuel, pays: evenement.target.value }))
              }
              placeholder="Suisse, France"
            />
          </Field>
        </div>

        <Field
          label="Ce que vous vendez"
          hint="Vos gammes principales. Naya s’en sert pour parler de vos campagnes avec vos mots."
        >
          <Textarea
            value={profil.produits}
            maxLength={400}
            onChange={(evenement) =>
              setProfil((actuel) => ({ ...actuel, produits: evenement.target.value }))
            }
            placeholder="Bougies parfumées, coffrets cadeaux, recharges de cire"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          {enregistre ? (
            <span className="text-sm text-[var(--color-positive)]">Enregistré.</span>
          ) : null}
          {erreur === null ? null : (
            <span role="alert" className="text-sm text-[var(--color-critical)]">
              {erreur}
            </span>
          )}
        </div>
      </form>
    </details>
  )
}
