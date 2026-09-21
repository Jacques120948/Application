/**
 * Ce que vos campagnes disent, et ce que les gens ont tapé pour les voir.
 *
 * L'écran des chiffres répond à « combien ». Celui-ci répond à « avec quoi » — et c'est la
 * question qu'il faut avoir posée avant de vouloir améliorer quoi que ce soit. Proposer un
 * titre sans connaître les quinze qui existent revient à proposer le seizième doublon.
 *
 * Trois partis pris.
 *
 * **Le remplissage est dit en clair.** « 8 titres sur 15 » se lit d'un coup d'œil et désigne
 * un travail ; « 8 titres » ne désigne rien. Google donne moins de place aux annonces qui
 * lui donnent moins de matière, et c'est le premier levier, avant toute réécriture.
 *
 * **La note de Google est reprise telle quelle.** LOW, GOOD, BEST : c'est un classement
 * relatif entre les morceaux d'un même contenant, pas une note sur cent. La traduire en
 * pourcentage inventerait une échelle que Google n'a jamais donnée.
 *
 * **Une campagne sans terme de recherche n'est pas une campagne sans demande.** Une
 * Performance Max ne livre que des catégories agrégées ; Google ne rend pas les mots. Le
 * dire vaut mieux que de laisser conclure à une campagne que personne ne cherche.
 */

import { PropositionsAds, type PropositionVue } from './PropositionsAds'

export type ElementVu = {
  id: string
  texte: string
  performance: string
  origine: string
}

export type GroupeVu = {
  id: string
  nom: string
  genre: string
  statut: string
  campagne: string
  typeCampagne: string
  titres: ElementVu[]
  titresLongs: ElementVu[]
  descriptions: ElementVu[]
  images: ElementVu[]
  motsCles: string[]
}

export type TermeVu = {
  terme: string
  campagne: string
  impressions: number
  clics: number
  conversions: number
  cout: number
  intention: string
}

/**
 * Ce que Google accepte au maximum, par genre de contenant.
 *
 * Écrits ici plutôt que devinés : ce sont les bornes qui rendent « 8 sur 15 » lisible, et
 * une borne inventée ferait croire à un travail fini alors qu'il reste de la place.
 */
const MAXIMUMS: Record<string, { titres: number; titresLongs: number; descriptions: number; images: number }> = {
  annonces: { titres: 15, titresLongs: 0, descriptions: 4, images: 0 },
  elements: { titres: 15, titresLongs: 5, descriptions: 5, images: 20 },
}

const GENRES: Record<string, string> = {
  annonces: 'Groupe d’annonces',
  elements: 'Groupe d’éléments',
}

const NOTES: Record<string, { mot: string; couleur: string }> = {
  BEST: { mot: 'Meilleur', couleur: 'var(--color-positive)' },
  GOOD: { mot: 'Bon', couleur: 'var(--color-ink-soft)' },
  LOW: { mot: 'Faible', couleur: 'var(--color-caution)' },
  LEARNING: { mot: 'En apprentissage', couleur: 'var(--color-ink-faint)' },
  PENDING: { mot: 'En attente', couleur: 'var(--color-ink-faint)' },
}

const INTENTIONS: Record<string, string> = {
  achat: 'Achat',
  comparaison: 'Comparaison',
  local: 'Local',
  information: 'Information',
}

function Remplissage({ quoi, combien, sur }: { quoi: string; combien: number; sur: number }) {
  if (sur === 0) return null
  const complet = combien >= sur
  return (
    <span className="text-xs" style={{ color: complet ? 'var(--color-positive)' : 'var(--color-caution)' }}>
      {combien}/{sur} {quoi}
    </span>
  )
}

function Liste({
  titre,
  elements,
  maximum,
  longueur,
}: {
  titre: string
  elements: ElementVu[]
  maximum: number
  /** La longueur que Google accepte pour ce champ. Affichée à côté de chaque texte. */
  longueur: number
}) {
  if (maximum === 0) return null
  return (
    <div className="mt-4">
      <p className="m-0 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        {titre} — {elements.length} sur {maximum}
      </p>
      {elements.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-ink-faint)]">Aucun.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {elements.map((element) => {
            const note = NOTES[element.performance]
            return (
              <li key={element.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">
                  {element.texte}
                  {element.origine === 'evoliia' ? (
                    <span className="ml-2 text-xs text-[var(--color-brand-strong)]">
                      proposé par Naya
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-3 text-xs text-[var(--color-ink-faint)]">
                  {note === undefined ? null : <span style={{ color: note.couleur }}>{note.mot}</span>}
                  <span>
                    {element.texte.length}/{longueur}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function Annonces({
  groupes,
  termes,
  lu,
  propositions,
  assiste,
}: {
  groupes: readonly GroupeVu[]
  termes: readonly TermeVu[]
  lu: boolean
  /** Ce que Naya propose, par contenant. Montré à côté de l'existant, jamais mêlé. */
  propositions: Record<string, PropositionVue[]>
  /** Vrai quand le compte est en mode assisté : sans cela, aucun dépôt n'est possible. */
  assiste: boolean
}) {
  if (!lu) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed">
          Le contenu de vos campagnes n’a pas encore été lu. Il se relit une fois par semaine —
          les titres d’une annonce ne changent pas tous les jours — ou tout de suite si vous
          cliquez « Lire mes campagnes maintenant » sur la page Publicité.
        </p>
      </div>
    )
  }

  const avecTermes = new Set(termes.map((terme) => terme.campagne))
  const sansTermes = [...new Set(groupes.map((groupe) => groupe.campagne))].filter(
    (campagne) => !avecTermes.has(campagne),
  )

  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="m-0 text-base font-semibold">Ce que vos campagnes disent</h2>

        {groupes.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Aucun contenu lu sur ce compte. Vos campagnes n’ont peut-être ni annonce
              responsive ni groupe d’éléments — c’est le cas des campagnes Shopping, dont les
              annonces viennent de votre catalogue produits.
            </p>
          </div>
        ) : (
          groupes.map((groupe) => {
            const max = MAXIMUMS[groupe.genre] ?? MAXIMUMS.annonces
            if (max === undefined) return null
            return (
              <article
                key={groupe.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 text-sm font-medium">{groupe.nom}</p>
                  <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                    {GENRES[groupe.genre] ?? groupe.genre} · {groupe.campagne}
                  </p>
                </div>

                <div className="mt-2 flex flex-wrap gap-4">
                  <Remplissage quoi="titres" combien={groupe.titres.length} sur={max.titres} />
                  <Remplissage
                    quoi="descriptions"
                    combien={groupe.descriptions.length}
                    sur={max.descriptions}
                  />
                  <Remplissage
                    quoi="titres longs"
                    combien={groupe.titresLongs.length}
                    sur={max.titresLongs}
                  />
                  <Remplissage quoi="images" combien={groupe.images.length} sur={max.images} />
                </div>

                {groupe.motsCles.length === 0 ? null : (
                  /*
                    Ce que le contenant cible, dit avant ses textes. C'est ce qui permet de
                    juger un titre : « Bracelet Pierre Naturelle » n'est pas un mauvais titre
                    en soi, il est hors sujet dans un groupe qui cible des bougies — et
                    Google le montrerait à quelqu'un qui cherche une bougie.
                  */
                  <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                    <span className="text-[var(--color-ink-faint)]">Cible : </span>
                    {groupe.motsCles.slice(0, 12).join(' · ')}
                    {groupe.motsCles.length > 12
                      ? ` · et ${groupe.motsCles.length - 12} autres`
                      : ''}
                  </p>
                )}

                <Liste titre="Titres" elements={groupe.titres} maximum={max.titres} longueur={30} />
                <Liste
                  titre="Titres longs"
                  elements={groupe.titresLongs}
                  maximum={max.titresLongs}
                  longueur={90}
                />
                <Liste
                  titre="Descriptions"
                  elements={groupe.descriptions}
                  maximum={max.descriptions}
                  longueur={90}
                />

                {max.images === 0 ? null : (
                  <div className="mt-4">
                    <p className="m-0 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
                      Images — {groupe.images.length} sur {max.images}
                    </p>
                    {groupe.images.length === 0 ? (
                      <p className="m-0 text-sm text-[var(--color-ink-faint)]">Aucune.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {groupe.images.map((image) => (
                          /*
                            Les vignettes viennent de Google et non d'Evoliia : elles sont
                            servies telles quelles, sans passer par l'optimiseur du cadre, qui
                            refuserait un domaine qu'il ne connaît pas.
                          */
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={image.id}
                            src={image.texte}
                            alt=""
                            loading="lazy"
                            className="h-20 w-20 rounded-[var(--radius-control)] border border-[var(--color-line)] object-cover"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <PropositionsAds
                  groupeId={groupe.id}
                  /*
                    Le dépôt n'existe pour l'instant que dans les groupes d'annonces : chez
                    Google, ajouter un élément à une Performance Max passe par un autre
                    chemin, celui des éléments, qui viendra avec les images.
                  */
                  deposable={assiste && groupe.genre === 'annonces'}
                  initiales={propositions[groupe.id] ?? []}
                  /*
                    Le plein se juge sur l'existant ET sur ce qui attend : sans cela, le
                    bouton laisserait demander quinze titres de plus à une annonce qui en a
                    déjà neuf et trois en attente, et la personne paierait pour des textes
                    qui n'ont nulle part où aller.
                  */
                  complet={
                    groupe.titres.length +
                      groupe.descriptions.length +
                      groupe.titresLongs.length +
                      (propositions[groupe.id]?.length ?? 0) >=
                    max.titres + max.descriptions + max.titresLongs
                  }
                />
              </article>
            )
          })
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">Ce que les gens ont tapé</h2>

        {termes.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Aucun terme de recherche n’est disponible sur ce compte. Google ne les rend que
              pour les campagnes à mots-clés : une Performance Max ne livre que des catégories
              agrégées, jamais les mots eux-mêmes.
            </p>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Votre Search Console, elle, donne bien les mots tapés pour arriver sur votre
              site. C’est de là que viendra la matière.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                    <th className="py-2 font-medium">Terme</th>
                    <th className="py-2 font-medium">Intention</th>
                    <th className="py-2 text-right font-medium">Impressions</th>
                    <th className="py-2 text-right font-medium">Clics</th>
                    <th className="py-2 text-right font-medium">Ventes</th>
                  </tr>
                </thead>
                <tbody>
                  {termes.map((terme) => (
                    <tr key={`${terme.campagne}-${terme.terme}`} className="border-b border-[var(--color-line)]">
                      <td className="py-2">{terme.terme}</td>
                      <td className="py-2 text-xs text-[var(--color-ink-soft)]">
                        {INTENTIONS[terme.intention] ?? terme.intention}
                      </td>
                      <td className="py-2 text-right">{terme.impressions.toLocaleString('fr-CH')}</td>
                      <td className="py-2 text-right">{terme.clics.toLocaleString('fr-CH')}</td>
                      <td className="py-2 text-right">
                        {terme.conversions === 0 ? '—' : terme.conversions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sansTermes.length === 0 ? null : (
              <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
                {sansTermes.length === 1
                  ? `La campagne « ${sansTermes[0]} » ne rend aucun terme`
                  : `${sansTermes.length} campagnes ne rendent aucun terme`}{' '}
                : Google ne les livre que pour les campagnes à mots-clés. Ce n’est pas une
                campagne sans demande, c’est une campagne dont Google garde les mots.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
