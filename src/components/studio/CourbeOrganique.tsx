/**
 * Le trafic qu'on ne paie pas, jour après jour.
 *
 * La page des recherches disait déjà combien de clics et d'affichages les vingt-huit derniers
 * jours avaient donnés. Elle ne disait pas si c'était mieux qu'avant, et c'est pourtant la
 * seule question qu'on se pose devant ces nombres. Un site qui fait trois cents clics par mois
 * depuis un an et un site qui vient de passer de cent à trois cents ont le même total et deux
 * histoires opposées.
 *
 * Quatre partis pris, dont trois sont repris de la courbe publicitaire — même écriture à la
 * main, même échelle partant de zéro, même défilement sur petit écran.
 *
 * **Deux axes, et c'est assumé.** Les clics et les affichages ne se comptent pas dans la même
 * unité d'ordre de grandeur : un site sort vingt à cinquante fois pour un clic. Sur une seule
 * échelle, la courbe des clics serait écrasée au ras de l'axe et ne montrerait rien. Les deux
 * échelles sont donc nommées et colorées, comme Search Console le fait — là où le
 * croisement des deux traits ne veut rien dire, et où il ne faut surtout pas le lire.
 *
 * **Les longues périodes sont regroupées par semaine.** Cinq cents barres dans sept cents
 * pixels font un pixel et demi chacune : ce n'est plus un graphique, c'est une texture. La
 * semaine garde la forme de la tendance et rend chaque barre lisible.
 */

export type JourOrganique = {
  jour: string
  clics: number
  impressions: number
  position: number
}

/**
 * Le haut de l'axe, arrondi vers un nombre qu'on lit sans effort.
 *
 * Repris tel quel de la courbe publicitaire. Les paliers intermédiaires évitent qu'un maximum
 * de cinquante-cinq fasse monter l'axe à cent, ce qui laisserait la moitié du cadre vide et
 * ferait passer un bon mois pour un mois mort.
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

/** Au-delà, le jour n'est plus lisible et la semaine dit la même chose en mieux. */
const JOURS_LISIBLES = 120

/**
 * Regroupe les jours par paquets, en partant de la fin.
 *
 * En partant de la fin, et non du début : le dernier paquet est celui qu'on regarde, et c'est
 * lui qui doit être complet. Un regroupement calé sur le premier jour laisserait la semaine
 * en cours amputée en bout de courbe, et la tendance finirait sur une chute qui n'existe pas.
 *
 * Le paquet le plus ancien, lui, peut être incomplet — il est en bord d'écran, on ne le lit
 * pas comme une tendance.
 */
export function regrouper(serie: readonly JourOrganique[], taille: number): JourOrganique[] {
  if (taille <= 1 || serie.length === 0) return [...serie]

  const paquets: JourOrganique[] = []
  for (let fin = serie.length; fin > 0; fin -= taille) {
    const tranche = serie.slice(Math.max(0, fin - taille), fin)
    const impressions = tranche.reduce((somme, jour) => somme + jour.impressions, 0)
    /*
     * La position se moyenne au prorata des affichages, pas des jours. Un jour à trois
     * affichages en position 40 ne doit pas peser autant qu'un jour à trois cents en
     * position 8 : la moyenne simple ferait plonger la semaine sur un échantillon de rien.
     */
    const poids = tranche.reduce((somme, jour) => somme + jour.position * jour.impressions, 0)
    paquets.push({
      jour: tranche[0]?.jour ?? '',
      clics: tranche.reduce((somme, jour) => somme + jour.clics, 0),
      impressions,
      position: impressions === 0 ? 0 : Number((poids / impressions).toFixed(1)),
    })
  }
  return paquets.reverse()
}

/** « 2026-09-21 » devient « 21.09 » : la date suisse, sans l'année qu'on connaît déjà. */
function court(jour: string): string {
  return `${jour.slice(8, 10)}.${jour.slice(5, 7)}`
}

function nombre(valeur: number): string {
  return valeur.toLocaleString('fr-CH').replace(/ | /g, ' ')
}

const LARGEUR = 720
const HAUTEUR = 260
const MARGE = { gauche: 46, droite: 52, haut: 14, bas: 34 }

export function CourbeOrganique({ serie }: { serie: readonly JourOrganique[] }) {
  if (serie.length < 2) {
    return (
      <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="m-0 text-base font-semibold">L’évolution</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Google n’a pas encore assez de jours à montrer pour tracer une courbe. Revenez dans
          quelques jours : ses chiffres ont deux à trois jours de retard.
        </p>
      </section>
    )
  }

  const paquets = regrouper(serie, serie.length > JOURS_LISIBLES ? 7 : 1)
  const parSemaine = paquets.length !== serie.length

  const maxClics = Math.max(...paquets.map((paquet) => paquet.clics))
  const maxVues = Math.max(...paquets.map((paquet) => paquet.impressions))

  if (maxVues <= 0) {
    return (
      <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="m-0 text-base font-semibold">L’évolution</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Google n’a affiché aucune de vos pages sur cette période. Il n’y a rien à tracer :
          votre site est peut-être trop récent, ou bloqué à l’indexation.
        </p>
      </section>
    )
  }

  const hautClics = plafond(maxClics)
  const hautVues = plafond(maxVues)
  const largeurTracé = LARGEUR - MARGE.gauche - MARGE.droite
  const hauteurTracé = HAUTEUR - MARGE.haut - MARGE.bas
  const pas = largeurTracé / paquets.length
  const largeurBarre = Math.max(1.5, pas * 0.62)

  const x = (index: number) => MARGE.gauche + pas * index + pas / 2
  const y = (valeur: number, haut: number) => MARGE.haut + hauteurTracé * (1 - valeur / haut)

  const ligne = paquets
    .map((paquet, index) => `${x(index)},${y(paquet.impressions, hautVues)}`)
    .join(' ')

  /*
   * Une étiquette de date tous les n paquets : au-delà d'une dizaine, elles se chevauchent et
   * deviennent une bande grise illisible. Le dernier est toujours lisible parce que c'est lui
   * qui date la courbe.
   */
  const espacement = Math.max(1, Math.ceil(paquets.length / 8))
  const totalClics = paquets.reduce((somme, paquet) => somme + paquet.clics, 0)
  const totalVues = paquets.reduce((somme, paquet) => somme + paquet.impressions, 0)

  return (
    /*
      `min-w-0` n'est pas décoratif : sans lui, la largeur minimale du graphique pousserait
      toute la page, et le téléphone défilerait horizontalement d'un bout à l'autre de
      l'écran au lieu de ne faire glisser que la courbe.
    */
    <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">L’évolution</h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-ink-soft)]">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: 'var(--color-brand)' }}
            />
            Clics
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: 'var(--color-accent-warm)' }}
            />
            Affichages
          </span>
        </div>
      </div>

      {/*
        Sur un téléphone, une courbe réduite à trois cent cinquante pixels rend ses
        étiquettes de date illisibles et ses barres indistinctes. Plutôt qu'une vignette dont
        on ne peut rien tirer, le cadre défile : on lit la même courbe, en faisant glisser.
      */}
      <div className="-mx-1 mt-4 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
          className="h-auto w-full min-w-[600px]"
          role="img"
          aria-label={`Trafic naturel du ${court(paquets[0]?.jour ?? '')} au ${court(
            serie[serie.length - 1]?.jour ?? '',
          )} : ${nombre(totalClics)} clics pour ${nombre(totalVues)} affichages.`}
        >
          {/* Les repères horizontaux, et les deux échelles qui commencent à zéro. */}
          {[0, 0.25, 0.5, 0.75, 1].map((part) => (
            <g key={part}>
              <line
                x1={MARGE.gauche}
                x2={LARGEUR - MARGE.droite}
                y1={y(hautClics * part, hautClics)}
                y2={y(hautClics * part, hautClics)}
                stroke="var(--color-line)"
                strokeWidth={1}
                strokeDasharray={part === 0.25 || part === 0.75 ? '3 4' : undefined}
              />
              {part === 0.25 || part === 0.75 ? null : (
                <>
                  <text
                    x={MARGE.gauche - 8}
                    y={y(hautClics * part, hautClics) + 4}
                    textAnchor="end"
                    fontSize={12}
                    fill="var(--color-brand)"
                  >
                    {nombre(Math.round(hautClics * part))}
                  </text>
                  <text
                    x={LARGEUR - MARGE.droite + 8}
                    y={y(hautVues * part, hautVues) + 4}
                    textAnchor="start"
                    fontSize={12}
                    fill="var(--color-accent-warm)"
                  >
                    {nombre(Math.round(hautVues * part))}
                  </text>
                </>
              )}
            </g>
          ))}

          {paquets.map((paquet, index) => (
            <rect
              key={paquet.jour}
              x={x(index) - largeurBarre / 2}
              y={y(paquet.clics, hautClics)}
              width={largeurBarre}
              height={Math.max(0, hauteurTracé - (y(paquet.clics, hautClics) - MARGE.haut))}
              rx={largeurBarre > 6 ? 2 : 0}
              fill="var(--color-brand)"
              opacity={0.85}
            >
              <title>
                {`${court(paquet.jour)}${parSemaine ? ' (semaine)' : ''} — ${nombre(
                  paquet.clics,
                )} clics pour ${nombre(paquet.impressions)} affichages${
                  paquet.position === 0 ? '' : `, place ${paquet.position.toFixed(1)}`
                }`}
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

          {paquets.length <= 14
            ? paquets.map((paquet, index) => (
                <circle
                  key={paquet.jour}
                  cx={x(index)}
                  cy={y(paquet.impressions, hautVues)}
                  r={2.5}
                  fill="var(--color-accent-warm)"
                />
              ))
            : null}

          {paquets.map((paquet, index) =>
            index % espacement === 0 || index === paquets.length - 1 ? (
              <text
                key={paquet.jour}
                x={x(index)}
                y={HAUTEUR - 12}
                textAnchor="middle"
                fontSize={12}
                fill="var(--color-ink-faint)"
              >
                {court(paquet.jour)}
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
        {parSemaine ? 'Une barre par semaine. ' : ''}Les deux échelles sont différentes : les
        clics à gauche, les affichages à droite. Un site sort vingt à cinquante fois pour un
        clic — sur une échelle commune, les clics seraient invisibles. Le croisement des deux
        traits ne veut donc rien dire. Les deux partent de zéro.
      </p>
    </section>
  )
}
