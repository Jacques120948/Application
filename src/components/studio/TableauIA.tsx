/**
 * Le tableau de bord de la visibilité dans les assistants.
 *
 * Trois partis pris, chacun contre une façon de mentir avec ces chiffres.
 *
 * **Rien n'est porté par la seule courbe.** Chaque nombre est écrit en toutes lettres ; la
 * courbe ne fait que soutenir la lecture. Une donnée qui n'existe que dans un tracé est
 * illisible pour qui voit mal, et invérifiable pour tout le monde.
 *
 * **Une fréquence ne se juge jamais seule.** « 35 % » ne dit rien : personne ne sait ce
 * qu'est une bonne fréquence dans un assistant. « 35 %, contre 22 % le mois d'avant » dit
 * tout. La comparaison est donc affichée partout où elle existe, et rien n'est affiché à sa
 * place quand elle n'existe pas encore.
 *
 * **Pas de part de voix.** Une part de voix suppose de compter les mentions de chaque
 * marque, donc de décider ce qui est une marque, et de le faire assez bien pour qu'un
 * pourcentage veuille dire quelque chose. Ce qu'on a, ce sont les pages que les assistants
 * citent : un fait, pas une estimation, rendu sous son vrai nom.
 */

export type CarteVue = {
  plateforme: string
  releves: number
  mentions: number
  frequence: number
  variation: number | null
  serie: number[]
}

export type SiteCiteVu = { domaine: string; citations: number; sien: boolean }

export type TableauVu = {
  jours: number
  plateformes: CarteVue[]
  releves: number
  mentions: number
  frequence: number
  variation: number | null
  citeesPartout: number
  questions: number
  sentiment: string
  sites: SiteCiteVu[]
  sourcesUniques: number
}

const NOMS: Record<string, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
}

const TONS: Record<string, string> = {
  bon: 'Cité en bien',
  neutre: 'Cité sans opinion',
  reserve: 'Cité avec réserve',
  inconnu: 'Pas encore de mention',
}

/** La variation, dite avec son signe et sa direction. Jamais une flèche seule. */
function Variation({ valeur }: { valeur: number | null }) {
  if (valeur === null) {
    return (
      <span className="text-xs text-[var(--color-ink-faint)]">
        pas encore de période précédente
      </span>
    )
  }
  if (valeur === 0) {
    return <span className="text-xs text-[var(--color-ink-faint)]">stable</span>
  }
  const monte = valeur > 0
  return (
    <span
      className="text-xs"
      style={{ color: monte ? 'var(--color-positive)' : 'var(--color-critical)' }}
    >
      {monte ? '+' : ''}
      {valeur} point{Math.abs(valeur) > 1 ? 's' : ''} {monte ? 'de plus' : 'de moins'}
    </span>
  )
}

/**
 * La courbe d'une plateforme.
 *
 * Volontairement muette : ni axe, ni graduation, ni étiquette. Elle dit une direction, et
 * les chiffres qui comptent sont écrits à côté. Un graphique qui prétendrait se lire au
 * pixel près sur quatre points hebdomadaires mentirait sur sa propre précision.
 */
function Courbe({ serie }: { serie: readonly number[] }) {
  if (serie.length < 2) return null
  const haut = Math.max(100, ...serie)
  const pas = 100 / (serie.length - 1)
  const points = serie.map((valeur, rang) => `${rang * pas},${30 - (valeur / haut) * 30}`)

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="mt-3 h-10 w-full"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function Carte({ carte }: { carte: CarteVue }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="m-0 text-sm font-semibold">{NOMS[carte.plateforme] ?? carte.plateforme}</p>
      {carte.releves === 0 ? (
        <p className="mt-3 mb-0 text-sm text-[var(--color-ink-faint)]">
          Aucun relevé sur cette période.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-4">
            <p className="m-0">
              <span className="text-2xl font-semibold">{carte.frequence}&nbsp;%</span>
              <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">
                des relevés vous citent
              </span>
            </p>
            <p className="m-0">
              <span className="text-lg font-medium">
                {carte.mentions}/{carte.releves}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">
                mentions sur relevés
              </span>
            </p>
          </div>
          <p className="mt-2 mb-0">
            <Variation valeur={carte.variation} />
          </p>
          <Courbe serie={carte.serie} />
        </>
      )}
    </div>
  )
}

function Chiffre({ valeur, quoi }: { valeur: string; quoi: string }) {
  return (
    <div className="px-4 py-3">
      <p className="m-0 text-xl font-semibold">{valeur}</p>
      <p className="m-0 mt-0.5 text-xs leading-relaxed text-[var(--color-ink-faint)]">{quoi}</p>
    </div>
  )
}

export function TableauIA({ tableau }: { tableau: TableauVu }) {
  const autres = tableau.sites.filter((site) => !site.sien)
  const maximum = Math.max(1, ...tableau.sites.map((site) => site.citations))

  if (tableau.releves === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed">
          Aucun relevé sur les {tableau.jours} derniers jours. Posez vos questions une
          première fois : ce tableau se remplit à partir des réponses, et il ne prend son sens
          qu’au deuxième passage — un chiffre de visibilité ne se juge pas dans l’absolu, il
          se compare au précédent.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tableau.plateformes.map((carte) => (
          <Carte key={carte.plateforme} carte={carte} />
        ))}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="m-0 text-sm font-semibold">Comment vous êtes cité</p>
          <p className="mt-3 mb-0 text-lg font-medium">
            {TONS[tableau.sentiment] ?? TONS.inconnu}
          </p>
          <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Lu sur le ton des passages où votre nom apparaît. C’est une lecture sommaire, pas
            un jugement : le passage exact est consultable question par question.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 divide-x divide-[var(--color-line)] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] sm:grid-cols-3 lg:grid-cols-5">
        <Chiffre valeur={`${tableau.frequence} %`} quoi="des relevés vous citent" />
        <Chiffre
          valeur={`${tableau.mentions}`}
          quoi={`mentions sur ${tableau.releves} relevés`}
        />
        <Chiffre
          valeur={`${tableau.citeesPartout}`}
          quoi="questions où vous sortez sur toutes les plateformes"
        />
        <Chiffre valeur={`${tableau.questions}`} quoi="questions où vous sortez au moins une fois" />
        <Chiffre valeur={`${tableau.sourcesUniques}`} quoi="adresses distinctes citées" />
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm font-semibold">Ce que les assistants ont lu</p>
        <p className="mt-1 mb-4 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          Les pages citées dans les réponses à vos questions. Ce ne sont pas des « parts de
          voix » : ce sont les adresses que les assistants ont réellement ouvertes, comptées
          telles quelles. {autres.length === 0 ? '' : 'Celles qui ne sont pas les vôtres sont vos concurrents sur ces questions.'}
        </p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {tableau.sites.map((site) => (
            <li key={site.domaine} className="flex items-center gap-3">
              <span
                className={`w-44 shrink-0 truncate text-xs ${site.sien ? 'font-semibold' : ''}`}
              >
                {site.domaine}
                {site.sien ? ' (vous)' : ''}
              </span>
              <span
                aria-hidden="true"
                className="h-2 rounded-[var(--radius-pill)]"
                style={{
                  width: `${(site.citations / maximum) * 100}%`,
                  minWidth: '2px',
                  background: site.sien ? 'var(--color-brand)' : 'var(--color-line)',
                }}
              />
              <span className="ml-auto text-xs whitespace-nowrap text-[var(--color-ink-faint)]">
                {site.citations}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Ces chiffres sont des fréquences observées sur {tableau.jours} jours, pas un état.
        Les réponses d’un assistant ne sont pas identiques d’une fois sur l’autre : ce qui
        compte est le mouvement, pas la valeur d’un jour. Aucune action ne garantit
        l’apparition d’une marque dans un assistant.
      </p>
    </div>
  )
}
