'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { OBJECTIFS, OBJECTIFS_MAX, type Activite } from '@/lib/objectifs'

/**
 * « Mes objectifs » : ce que l'entreprise cherche, par ordre d'importance.
 *
 * L'ordre du clic est l'ordre d'importance : le premier choisi pèse plus que le second.
 * C'est plus simple qu'un classement à glisser, et c'est ce qu'on fait naturellement — on
 * clique d'abord sur ce qui compte le plus. Un numéro sur chaque choix le rend visible.
 *
 * Deux au plus. Un troisième clic ne fait rien et le dit : au-delà, tout redevient
 * prioritaire, et rien ne l'est plus.
 *
 * Les objectifs qu'aucun agent ne sait encore servir sont affichés, grisés, avec la
 * raison. Les cacher laisserait croire qu'on ne les a pas entendus ; les rendre
 * sélectionnables laisserait croire qu'ils changent quelque chose.
 */
export function ObjectifsOria({
  siteId,
  initiaux,
  activite: activiteInitiale,
  deduite,
}: {
  siteId: string
  initiaux: readonly string[]
  activite: Activite | ''
  /** L'activité vient d'une déduction (boutique Shopify reliée), pas d'une réponse. */
  deduite: boolean
}) {
  const router = useRouter()
  const [choisis, setChoisis] = useState<string[]>([...initiaux])
  const [activite, setActivite] = useState<Activite | ''>(activiteInitiale)
  const [occupe, setOccupe] = useState(false)
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null)

  function basculer(id: string) {
    if (choisis.includes(id)) {
      setChoisis(choisis.filter((un) => un !== id))
      setMessage(null)
      return
    }
    if (choisis.length >= OBJECTIFS_MAX) {
      setMessage({ ton: 'erreur', texte: 'Deux objectifs au plus : retirez-en un d’abord.' })
      return
    }
    setChoisis([...choisis, id])
    setMessage(null)
  }

  async function enregistrer() {
    setOccupe(true)
    setMessage(null)
    const reponse = await fetch('/api/oria/objectifs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId,
        objectifs: choisis,
        // Une activité déduite et non retouchée n'est pas enregistrée : elle reste une
        // déduction, et suivra la boutique si elle est déliée.
        ...(deduite && activite === activiteInitiale ? {} : { activite }),
      }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(false)
    if (reponse === null || !reponse.ok) {
      setMessage({
        ton: 'erreur',
        texte: corps?.message ?? `L’enregistrement n’a pas abouti (code ${reponse?.status ?? 0}).`,
      })
      return
    }
    setMessage({ ton: 'ok', texte: 'Enregistré. Oria a reclassé ses priorités.' })
    router.refresh()
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <h2 className="m-0 text-base font-semibold">Mes objectifs</h2>
      <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Deux au plus, dans l’ordre où vous les choisissez. Oria fait remonter les constats des
        spécialistes qui y travaillent — sans jamais faire passer une panne après une
        opportunité.
      </p>

      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {OBJECTIFS.map((un) => {
          const rang = choisis.indexOf(un.id)
          const indisponible = un.indisponible !== ''
          return (
            <li key={un.id}>
              <button
                type="button"
                disabled={indisponible}
                aria-pressed={rang >= 0}
                onClick={() => basculer(un.id)}
                className={`flex w-full items-start gap-3 rounded-[var(--radius-control)] border p-3 text-left text-sm transition ${
                  rang >= 0
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]'
                } disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-[var(--color-line)]`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    rang >= 0
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'border border-[var(--color-line)] text-transparent'
                  }`}
                >
                  {rang >= 0 ? rang + 1 : '·'}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{un.label}</span>
                  {indisponible ? (
                    <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">
                      {un.indisponible}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <fieldset className="m-0 mt-5 border-0 p-0">
        <legend className="mb-2 text-sm font-medium">Votre activité</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['boutique', 'Je vends des produits'],
              ['services', 'Je vends des prestations'],
            ] as const
          ).map(([valeur, libelle]) => (
            <label
              key={valeur}
              className={`cursor-pointer rounded-[var(--radius-pill)] border px-3 py-1.5 text-sm ${
                activite === valeur
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                  : 'border-[var(--color-line)]'
              }`}
            >
              <input
                type="radio"
                name="activite"
                value={valeur}
                checked={activite === valeur}
                onChange={() => {
                  setActivite(valeur)
                  setMessage(null)
                }}
                className="sr-only"
              />
              {libelle}
            </label>
          ))}
        </div>
        {deduite ? (
          <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
            Déduit de votre boutique Shopify reliée — inutile de nous le dire.
          </p>
        ) : null}
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={enregistrer}
          disabled={occupe}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {message === null ? null : (
          <p
            role={message.ton === 'erreur' ? 'alert' : 'status'}
            className="m-0 text-sm"
            style={{ color: message.ton === 'erreur' ? 'var(--color-critical)' : 'var(--color-positive)' }}
          >
            {message.texte}
          </p>
        )}
      </div>
    </section>
  )
}
