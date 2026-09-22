'use client'

import { useState } from 'react'

/**
 * Ce que Naya a trouvé, et ce qu'on peut en faire.
 *
 * Chaque avis porte les chiffres qui l'ont déclenché, et c'est le point : « 143 % sur trente
 * jours pour un seuil de 250 % » se vérifie et se conteste ; « cette campagne
 * sous-performe » ne se vérifie pas. Une recommandation qu'on ne peut pas contester est une
 * recommandation qu'on applique de confiance, et la confiance n'est pas ce qu'on devrait
 * engager pour dépenser de l'argent.
 *
 * Trois partis pris.
 *
 * **Rien ne s'applique ici.** Aucun bouton n'envoie quoi que ce soit chez Google. La liste
 * décrit, elle n'agit pas — et tant que l'écriture n'existe pas, un bouton « appliquer »
 * inerte serait pire que pas de bouton du tout.
 *
 * **« Ce n'est pas un problème » écarte pour un mois, pas pour toujours.** Rouvrir le
 * lendemain un avis refusé la veille est la façon la plus sûre de faire cesser de lire une
 * liste. Le taire à jamais en est l'autre : la situation, elle, n'a pas disparu.
 *
 * **L'ancienneté se dit.** « Ouverte depuis douze jours » change la lecture d'un avis :
 * ce qui dure n'est pas ce qui vient d'arriver.
 */

export type RecommandationVue = {
  id: string
  regle: string
  priorite: 'urgent' | 'surveiller' | 'opportunite' | 'information'
  titre: string
  observation: string
  jours: number
  risque: 'faible' | 'moyen' | 'eleve'
  /** Jours écoulés depuis l'ouverture, calculés côté serveur. */
  age: number
  campagne: string | null
  /**
   * Ce qu'Evoliia enverrait à Google, monté sur les chiffres du moment.
   *
   * `null` quand le constat n'appelle aucune action — un budget qui dérape se regarde, il
   * ne se corrige pas d'un bouton — ou quand la valeur d'avant n'est plus celle qu'avait vue
   * la règle.
   */
  action: ActionProposeeVue | null
}

export type ActionProposeeVue =
  | { type: 'budget'; campagneId: string; versMicros: number; attenduMicros: number; resume: string }
  | { type: 'statut'; campagneId: string; vers: 'PAUSED'; attendu: string; resume: string }
  | { type: 'exclusion'; campagneId: string; terme: string; resume: string }

const PRIORITES: Record<
  RecommandationVue['priorite'],
  { mot: string; couleur: string; fond: string }
> = {
  urgent: { mot: 'À traiter', couleur: 'var(--color-critical)', fond: 'var(--color-critical-soft)' },
  opportunite: {
    mot: 'Occasion',
    couleur: 'var(--color-positive)',
    fond: 'var(--color-positive-soft)',
  },
  surveiller: { mot: 'À surveiller', couleur: 'var(--color-caution)', fond: 'var(--color-caution-soft)' },
  information: {
    mot: 'Bon à savoir',
    couleur: 'var(--color-ink-soft)',
    fond: 'var(--color-canvas)',
  },
}

export function RecommandationsAds({
  initiales,
  /** Vrai quand la marge n'est pas renseignée : la moitié des règles se taisent alors. */
  sansMarge,
  /** Vrai quand le compte est en mode assisté : sans cela, aucun bouton d'action. */
  assiste,
  ancre,
}: {
  initiales: readonly RecommandationVue[]
  sansMarge: boolean
  assiste: boolean
  ancre: string
}) {
  const [liste, setListe] = useState<RecommandationVue[]>([...initiales])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  /*
   * La confirmation est un état, pas une fenêtre du navigateur. `confirm()` ne permet pas
   * d'écrire la phrase exacte de ce qui va partir, et c'est précisément cette phrase qui
   * fait la différence entre confirmer et cliquer.
   */
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)

  async function appliquer(une: RecommandationVue) {
    if (une.action === null) return
    setOccupe(une.id)
    setErreur(null)
    const reponse = await fetch('/api/ads/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...une.action, recommandationId: une.id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { ok?: boolean; raison?: string; message?: string }
      | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `L’envoi n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok !== true) {
      setErreur(corps?.raison ?? 'Google n’a pas accepté la modification.')
      setAConfirmer(null)
      return
    }
    // La page est rendue côté serveur : budget, statut et journal ont tous changé.
    window.location.reload()
  }

  async function ecarter(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/recommandations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ecarter', id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le geste n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setListe((actuelles) => actuelles.filter((une) => une.id !== id))
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">Ce que Naya a remarqué</h2>
        {liste.length === 0 ? null : (
          <span className="text-xs text-[var(--color-ink-faint)]">
            {liste.length} point{liste.length > 1 ? 's' : ''} à regarder
          </span>
        )}
      </div>

      {liste.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <p className="m-0 text-sm leading-relaxed">
            Rien à signaler sur vos trente derniers jours. Aucune campagne ne dépense sans
            vendre, aucune ne décroche, aucun budget ne dérape.
          </p>
          {sansMarge ? (
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Attention tout de même : sans votre marge, Naya ne peut vérifier aucune
              rentabilité. La moitié de ses contrôles se taisent faute de savoir à partir de
              quel retour vous gagnez de l’argent.{' '}
              <a href={ancre}>Renseigner ma marge</a>.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {liste.map((une) => {
            const ton = PRIORITES[une.priorite]
            return (
              <li
                key={une.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-medium"
                    style={{ color: ton.couleur, backgroundColor: ton.fond }}
                  >
                    {ton.mot}
                  </span>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {une.age === 0 ? 'Repéré aujourd’hui' : `Ouvert depuis ${une.age} jour${une.age > 1 ? 's' : ''}`}
                  </span>
                </div>

                <p className="mt-2 mb-0 text-sm font-medium">{une.titre}</p>
                <p className="mt-1.5 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {une.observation}
                </p>

                {assiste && une.action !== null ? (
                  aConfirmer === une.id ? (
                    /*
                      La phrase exacte de ce qui va partir, avant le geste. C'est elle qu'on
                      confirme — pas un bouton dont on a déjà oublié le libellé en cliquant.
                    */
                    <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
                      <p className="m-0 text-sm font-medium">{une.action.resume}</p>
                      <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                        La modification part chez Google immédiatement. Sa valeur d’avant est
                        conservée : vous pourrez revenir en arrière depuis le journal, en bas
                        de cette page.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void appliquer(une)}
                          disabled={occupe !== null}
                          className="cursor-pointer rounded-[var(--radius-control)] border-0 px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
                        >
                          {occupe === une.id ? 'Envoi…' : 'Confirmer et envoyer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAConfirmer(null)}
                          disabled={occupe !== null}
                          className="cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : null
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {assiste && une.action !== null && aConfirmer !== une.id ? (
                    <button
                      type="button"
                      onClick={() => setAConfirmer(une.id)}
                      disabled={occupe !== null}
                      className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-brand-strong)] disabled:opacity-50"
                    >
                      Appliquer…
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void ecarter(une.id)}
                    disabled={occupe !== null}
                    className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
                  >
                    {occupe === une.id ? 'Un instant…' : 'Ce n’est pas un problème'}
                  </button>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {assiste
                      ? 'Écarté pour un mois. Aucune modification sans votre confirmation.'
                      : 'Écarté pour un mois. Rien n’est envoyé à Google.'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {erreur === null ? null : (
        <p role="alert" className="m-0 text-sm text-[var(--color-critical)]">
          {erreur}
        </p>
      )}

      <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Ces constats sont produits par des règles écrites, pas par une intelligence
        artificielle : chacun porte la condition et les chiffres qui l’ont déclenché, et se
        vérifie dans Google Ads. Naya peut vous les expliquer et en discuter — c’est alors
        qu’elle intervient.{' '}
        {assiste
          ? 'Aucune modification ne part sans que vous ayez lu et confirmé la phrase exacte de ce qui sera envoyé.'
          : ''}
      </p>
    </section>
  )
}
