/**
 * Ce que la publicité a dépensé chaque jour, et ce qu'elle a rapporté.
 *
 * Six cases de chiffres disent où l'on en est ; elles ne disent pas comment on y est arrivé.
 * Une semaine à trois cents francs de retour peut être sept jours réguliers ou un seul bon
 * samedi, et ce n'est pas la même campagne : dans le second cas, augmenter le budget du
 * lundi ne produira rien. C'est ce que cette courbe montre et que les cartes ne peuvent pas
 * montrer.
 *
 * Trois partis pris.
 *
 * **Les journées sans dépense sont dessinées.** Elles valent zéro, ce qui n'est pas la même
 * chose qu'une donnée absente. Les sauter rapprocherait deux barres séparées par une semaine
 * de silence et laisserait croire à une activité continue.
 *
 * **Rien n'est chargé pour l'afficher.** C'est du SVG écrit à la main, rendu par le serveur.
 * Une bibliothèque de graphiques pèse plus lourd que toute la page et n'ajouterait ici qu'une
 * infobulle.
 *
 * **L'échelle part de zéro.** Un axe qui commencerait au minimum constaté transformerait une
 * variation de trois francs en falaise. C'est la façon la plus courante de mentir avec un
 * graphique, et elle est involontaire neuf fois sur dix.
 */

export type JourneeVue = {
  jour: string
  cout: number
  valeur: number
  conversions: number
  clics: number
  roas: number | null
}

/**
 * Le haut de l'axe, arrondi vers un nombre qu'on lit sans effort.
 *
 * L'échelle est fine à dessein. Une grille qui ne connaîtrait que 1, 2, 5 et 10 ferait monter
 * l'axe à cent pour un maximum de cinquante-cinq : la moitié du cadre resterait vide, les
 * barres seraient deux fois trop petites, et une semaine correcte aurait l'air d'une semaine
 * morte. Les paliers intermédiaires évitent ce gâchis sans rendre les graduations bizarres.
 */
const PALIERS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

function plafond(valeur: number): number {
  if (valeur <= 0) return 1
  const puissance = 10 ** Math.floor(Math.log10(valeur))
  for (const pas of PALIERS) {
    if (valeur <= pas * puissance) return pas * puissance
  }
  return 10 * puissance
}

/** « 2026-09-21 » devient « 21.09 » : la date suisse, sans l'année qu'on connaît déjà. */
function court(jour: string): string {
  return `${jour.slice(8, 10)}.${jour.slice(5, 7)}`
}

function montant(valeur: number, devise: string): string {
  return `${valeur.toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

const LARGEUR = 720
const HAUTEUR = 260
const MARGE = { gauche: 52, droite: 10, haut: 14, bas: 34 }

export function CourbeAds({
  serie,
  devise,
}: {
  serie: readonly JourneeVue[]
  devise: string
}) {
  if (serie.length < 2) return null

  const maxi = Math.max(...serie.map((jour) => Math.max(jour.cout, jour.valeur)))
  if (maxi <= 0) {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="m-0 text-base font-semibold">Jour après jour</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Aucune dépense sur cette période : il n’y a rien à tracer. Vos campagnes sont peut-être
          en pause, ou leur budget est épuisé.
        </p>
      </section>
    )
  }

  const haut = plafond(maxi)
  const largeurTracé = LARGEUR - MARGE.gauche - MARGE.droite
  const hauteurTracé = HAUTEUR - MARGE.haut - MARGE.bas
  const pas = largeurTracé / serie.length
  const largeurBarre = Math.max(1.5, pas * 0.62)

  const x = (index: number) => MARGE.gauche + pas * index + pas / 2
  const y = (valeur: number) => MARGE.haut + hauteurTracé * (1 - valeur / haut)

  const ligne = serie.map((jour, index) => `${x(index)},${y(jour.valeur)}`).join(' ')

  /*
   * Une étiquette de date tous les n jours : au-delà d'une dizaine, elles se chevauchent et
   * deviennent une bande grise illisible. Le premier et le dernier jour sont toujours lisibles
   * parce que ce sont eux qui donnent son sens à la période.
   */
  const espacement = Math.max(1, Math.ceil(serie.length / 8))
  const totalCout = serie.reduce((somme, jour) => somme + jour.cout, 0)
  const totalValeur = serie.reduce((somme, jour) => somme + jour.valeur, 0)

  return (
    /*
      `min-w-0` n'est pas décoratif : un élément de grille refuse par défaut de descendre
      sous la largeur de son contenu. Sans lui, la largeur minimale du graphique pousserait
      toute la page, et le téléphone défilerait horizontalement d'un bout à l'autre du
      tableau de bord au lieu de ne faire glisser que la courbe.
    */
    <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">Jour après jour</h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-ink-soft)]">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: 'var(--color-brand)' }}
            />
            Dépensé
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: 'var(--color-accent-warm)' }}
            />
            Valeur générée
          </span>
        </div>
      </div>

      {/*
        Sur un téléphone, une courbe réduite à trois cent cinquante pixels rend ses
        étiquettes de date illisibles et ses barres indistinctes. Plutôt que de montrer une
        vignette dont on ne peut rien tirer, le cadre défile : on lit la même courbe, en
        faisant glisser. Une largeur minimale garantit que le texte reste à sa taille.
      */}
      <div className="-mx-1 mt-4 overflow-x-auto px-1">
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        className="h-auto w-full min-w-[600px]"
        role="img"
        aria-label={`Dépense et valeur générée du ${court(serie[0]?.jour ?? '')} au ${court(
          serie[serie.length - 1]?.jour ?? '',
        )} : ${montant(totalCout, devise)} dépensés, ${montant(totalValeur, devise)} générés.`}
      >
        {/* Les repères horizontaux, et l'échelle qui commence à zéro. */}
        {[0, 0.25, 0.5, 0.75, 1].map((part) => (
          <g key={part}>
            <line
              x1={MARGE.gauche}
              x2={LARGEUR - MARGE.droite}
              y1={y(haut * part)}
              y2={y(haut * part)}
              stroke="var(--color-line)"
              strokeWidth={1}
              strokeDasharray={part === 0.25 || part === 0.75 ? '3 4' : undefined}
            />
            {part === 0.25 || part === 0.75 ? null : (
              <text
                x={MARGE.gauche - 8}
                y={y(haut * part) + 4}
                textAnchor="end"
                fontSize={12}
                fill="var(--color-ink-faint)"
              >
                {Math.round(haut * part).toLocaleString('fr-CH')}
              </text>
            )}
          </g>
        ))}

        {serie.map((jour, index) => (
          <rect
            key={jour.jour}
            x={x(index) - largeurBarre / 2}
            y={y(jour.cout)}
            width={largeurBarre}
            height={Math.max(0, hauteurTracé - (y(jour.cout) - MARGE.haut))}
            rx={largeurBarre > 6 ? 2 : 0}
            fill="var(--color-brand)"
            opacity={0.85}
          >
            <title>
              {`${court(jour.jour)} — dépensé ${montant(jour.cout, devise)}, généré ${montant(
                jour.valeur,
                devise,
              )}${jour.roas === null ? '' : `, ROAS ${jour.roas} %`}`}
            </title>
          </rect>
        ))}

        <polyline
          points={ligne}
          fill="none"
          stroke="var(--color-accent-warm)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {serie.length <= 14
          ? serie.map((jour, index) => (
              <circle
                key={jour.jour}
                cx={x(index)}
                cy={y(jour.valeur)}
                r={2.5}
                fill="var(--color-accent-warm)"
              />
            ))
          : null}

        {serie.map((jour, index) =>
          index % espacement === 0 || index === serie.length - 1 ? (
            <text
              key={jour.jour}
              x={x(index)}
              y={HAUTEUR - 12}
              textAnchor="middle"
              fontSize={12}
              fill="var(--color-ink-faint)"
            >
              {court(jour.jour)}
            </text>
          ) : null,
        )}
      </svg>
      </div>

      {/* Le cadre défile sur petit écran, et une barre de défilement discrète ne se voit pas. */}
      <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)] sm:hidden">
        Faites glisser la courbe pour voir toute la période.
      </p>

      <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Les montants sont en {devise}. L’échelle part de zéro : un axe qui commencerait au
        minimum constaté transformerait une variation de trois francs en falaise.
      </p>
    </section>
  )
}
