'use client'

import { useState } from 'react'

/**
 * Ce que la boutique contient réellement, champ par champ.
 *
 * L'analyse du site public voit une page rendue ; ici on voit ce que le marchand a saisi, et
 * ce n'est pas la même chose. Un thème fabrique une balise quand elle manque — souvent en
 * tronquant le descriptif et en collant le nom de la boutique à la fin. La page semble alors
 * pourvue alors que le champ est vide, et l'analyse du site ne peut pas faire la différence.
 * Cet écran, si.
 *
 * Trois partis pris.
 *
 * **Ce qui cloche d'abord.** Personne n'ouvre cet écran pour relire ses cent fiches
 * conformes. Le filtre s'ouvre donc sur les pièces à reprendre, et le tout reste accessible.
 *
 * **La balise est montrée, pas résumée.** « Description trop longue » ne dit pas quoi faire ;
 * voir la phrase coupée au milieu, si.
 *
 * **Rien n'est modifiable ici.** La connexion est en lecture seule, l'écran le dit, et il ne
 * montre aucun bouton qui laisserait croire le contraire.
 */

export type PieceVue = {
  id: string
  titre: string
  url: string | null
  contexte: string
  metaTitle: string
  metaDescription: string
  defautTitre: 'manquant' | 'court' | 'long' | null
  defautDescription: 'manquant' | 'court' | 'long' | null
}

const DEFAUT_DIT: Record<string, string> = {
  manquant: 'vide',
  court: 'trop court',
  long: 'coupé dans les résultats',
}

/** Le même mot, accordé. Une description n'est pas « trop court ». */
const DEFAUT_DIT_FEMININ: Record<string, string> = {
  manquant: 'vide',
  court: 'trop courte',
  long: 'coupée dans les résultats',
}

function pluriel(nombre: number, mot: string): string {
  return nombre > 1 ? `${mot}s` : mot
}

function Balise({
  role,
  valeur,
  defaut,
  feminin,
}: {
  role: string
  valeur: string
  defaut: 'manquant' | 'court' | 'long' | null
  feminin: boolean
}) {
  const dit = defaut === null ? null : (feminin ? DEFAUT_DIT_FEMININ : DEFAUT_DIT)[defaut]
  return (
    <p className="m-0 mt-1 text-sm">
      <span className="text-[var(--color-ink-faint)]">{role} : </span>
      {valeur.trim() === '' ? (
        <span className="text-[var(--color-ink-faint)] italic">rien de saisi</span>
      ) : (
        <span>{valeur}</span>
      )}
      {dit === null ? null : (
        <span className="ml-2 text-xs text-[var(--color-caution,#b54708)]">
          ({dit}, {valeur.trim().length} signes)
        </span>
      )}
    </p>
  )
}

function Liste({ titre, pieces }: { titre: string; pieces: readonly PieceVue[] }) {
  const [tout, setTout] = useState(false)
  const aReprendre = pieces.filter(
    (piece) => piece.defautTitre !== null || piece.defautDescription !== null,
  )
  const montrees = tout ? pieces : aReprendre

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold">
          {titre} <span className="text-[var(--color-ink-faint)]">({pieces.length})</span>
        </h2>
        {aReprendre.length === 0 || pieces.length === aReprendre.length ? null : (
          <button
            type="button"
            onClick={() => setTout((actuel) => !actuel)}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-ink-soft)]"
          >
            {tout ? 'Ne montrer que ce qui cloche' : `Tout montrer (${pieces.length})`}
          </button>
        )}
      </div>

      {pieces.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-ink-soft)]">Rien de ce type dans la boutique.</p>
      ) : aReprendre.length === 0 && !tout ? (
        <p className="m-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
          Les {pieces.length} {pluriel(pieces.length, 'pièce')} sont correctement renseignées.{' '}
          <button
            type="button"
            onClick={() => setTout(true)}
            className="cursor-pointer border-0 bg-transparent p-0 text-sm underline"
          >
            Les voir quand même
          </button>
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {montrees.map((piece) => (
            <li
              key={piece.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{piece.titre}</span>
                <span className="text-xs text-[var(--color-ink-faint)]">{piece.contexte}</span>
                {piece.url === null ? null : (
                  <a
                    href={piece.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-[var(--color-ink-soft)]"
                  >
                    voir la page
                  </a>
                )}
              </div>
              <Balise
                role="Titre de résultat"
                valeur={piece.metaTitle}
                defaut={piece.defautTitre}
                feminin={false}
              />
              <Balise
                role="Description"
                valeur={piece.metaDescription}
                defaut={piece.defautDescription}
                feminin
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function BoutiqueBoard({
  boutique,
  produits,
  articles,
  tronque,
  plafond,
}: {
  boutique: string
  produits: readonly PieceVue[]
  articles: readonly PieceVue[]
  tronque: boolean
  plafond: number
}) {
  const aReprendre = [...produits, ...articles].filter(
    (piece) => piece.defautTitre !== null || piece.defautDescription !== null,
  ).length

  return (
    <div>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed">
          Lu chez <strong>{boutique}</strong> : {produits.length}{' '}
          {pluriel(produits.length, 'fiche')} {pluriel(produits.length, 'produit')} et{' '}
          {articles.length} {pluriel(articles.length, 'article')}.{' '}
          {aReprendre === 0
            ? 'Aucune balise à reprendre.'
            : `${aReprendre} ${pluriel(aReprendre, 'pièce')} à reprendre.`}
        </p>
        {/*
          La différence avec l'analyse du site mérite d'être dite : sans elle, deux écrans qui
          parlent du même texte et n'en disent pas la même chose passent pour une erreur.
        */}
        <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Ces champs sont ceux que vous avez saisis dans Shopify. Quand ils sont vides, votre
          thème en fabrique souvent un à la volée : la page paraît alors pourvue, et l’analyse
          de votre site public ne peut pas faire la différence. Cet écran, si.
        </p>
        <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Connexion en lecture seule : Evoliia lit votre boutique, elle ne peut rien y écrire.
        </p>
        {!tronque ? null : (
          <p className="mt-3 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm text-[var(--color-ink-soft)]">
            Votre boutique dépasse les {plafond} pièces lues par type : cette liste n’est pas
            complète.
          </p>
        )}
      </div>

      <Liste titre="Fiches produits" pieces={produits} />
      <Liste titre="Articles de blog" pieces={articles} />
    </div>
  )
}
