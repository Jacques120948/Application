import { Card, CardBody } from '@/components/ui'
import { PlanAction, type LigneVue } from './PlanAction'

/**
 * Le tableau de bord de la visibilité.
 *
 * C'est l'écran de retour : celui qu'on rouvre une semaine après avoir corrigé deux ou trois
 * choses, pour savoir si ça a servi. Quatre partis pris décident de sa forme.
 *
 * **Deux notes côte à côte, jamais une moyenne.** Un site peut être irréprochable pour un
 * moteur de recherche et inexploitable par un assistant — c'est même le cas ordinaire. Une
 * note unique effacerait exactement ce qu'il y a à montrer.
 *
 * **L'écart avant le chiffre.** « 69 sur 100 » ne dit pas si le travail de la semaine a
 * servi ; « +4 depuis le 3 septembre » le dit. C'est la seule chose qui fasse revenir
 * quelqu'un un mois plus tard, et la première analyse le dit aussi — « première analyse »
 * plutôt qu'un zéro qui se lirait comme une chute.
 *
 * **La note GEO ne promet rien.** Elle mesure une aptitude à être repris, jamais une
 * présence obtenue. Personne ne connaît les critères de ChatGPT, de Gemini ou de Perplexity,
 * et ils changent : la phrase sous la jauge le dit, et elle n'est pas négociable.
 *
 * **Léa parle, l'écran ne récite pas.** « J'ai lu 34 pages » se comprend avant d'être lu ;
 * « pagesCrawled : 34 » demande un effort. Ce qu'elle dit est entièrement calculé — aucun
 * modèle n'intervient dans cet écran.
 */

export type Note = number | null

export type TableauProps = {
  locale: string
  site: { id: string; host: string; label: string }
  audit: {
    finishedAt: Date | null
    pagesCrawled: number
    seoScore: Note
    geoScore: Note
    /** L'exploration s'est arrêtée avant d'avoir fait le tour du site. */
    partiel: boolean
  }
  precedent: { finishedAt: Date | null; seoScore: Note; geoScore: Note } | null
  historique: { finishedAt: Date | null; seoScore: Note; geoScore: Note }[]
  /** Les lignes du plan, avec leur état. Le composant qui les rend est interactif. */
  lignes: readonly LigneVue[]
  /** Ce qui a été traité et ne figure plus dans la dernière analyse. */
  reglees: readonly { checkId: string; label: string; engine: string; state: string }[]
  /** Fourchette annoncée pour une rédaction, lue dans le catalogue administrable. */
  cout: { min: number; max: number } | null
  /** Ce que la surveillance a repéré de cassé, et qui ne l'est pas encore redevenu. */
  alertes: readonly { checkId: string; label: string; why: string; detail: string }[]
}

/** Une date écrite comme on la dit. */
function enClair(date: Date | null, locale: string): string {
  if (date === null) return ''
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : locale, {
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function pluriel(nombre: number, singulier: string, pluriel_ = `${singulier}s`): string {
  return nombre > 1 ? pluriel_ : singulier
}

/**
 * La jauge d'une note.
 *
 * Un anneau plutôt qu'une barre : à deux notes côte à côte, deux barres se comparent mal
 * parce que l'œil suit leur longueur et non leur remplissage. L'anneau porte le chiffre en
 * son centre, ce qui évite d'avoir à le répéter à côté.
 */
function Anneau({ note, teinte }: { note: number; teinte: string }) {
  const rayon = 42
  const tour = 2 * Math.PI * rayon
  const rempli = (Math.max(0, Math.min(100, note)) / 100) * tour
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" role="presentation" aria-hidden="true">
      <circle cx="50" cy="50" r={rayon} fill="none" stroke="var(--color-line)" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={rayon}
        fill="none"
        stroke={teinte}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${rempli} ${tour}`}
        transform="rotate(-90 50 50)"
      />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[var(--color-ink)] text-[26px] font-semibold"
      >
        {note}
      </text>
    </svg>
  )
}

/** L'écart depuis l'analyse précédente, dit plutôt que signé. */
function Ecart({
  note,
  avant,
  quand,
  locale,
}: {
  note: number
  avant: Note
  quand: Date | null
  locale: string
}) {
  if (avant === null) {
    return <span className="text-sm text-[var(--color-ink-faint)]">Première analyse</span>
  }
  const delta = note - avant
  const date = enClair(quand, locale)
  if (delta === 0) {
    return (
      <span className="text-sm text-[var(--color-ink-faint)]">
        Inchangé{date === '' ? '' : ` depuis le ${date}`}
      </span>
    )
  }
  const monte = delta > 0
  return (
    <span
      className="text-sm font-medium"
      style={{ color: monte ? 'var(--color-brand-strong)' : 'var(--color-critical)' }}
    >
      {monte ? '+' : '−'}
      {Math.abs(delta)} point{Math.abs(delta) > 1 ? 's' : ''}
      {date === '' ? '' : ` depuis le ${date}`}
    </span>
  )
}

function CarteNote({
  titre,
  sousTitre,
  note,
  avant,
  quand,
  teinte,
  locale,
  reserve,
}: {
  titre: string
  sousTitre: string
  note: Note
  avant: Note
  quand: Date | null
  teinte: string
  locale: string
  /** La phrase qui empêche la note d'être lue comme une promesse. */
  reserve?: string
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-5">
          {note === null ? (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-8 border-[var(--color-line)] text-sm text-[var(--color-ink-faint)]">
              —
            </div>
          ) : (
            <Anneau note={note} teinte={teinte} />
          )}
          <div className="min-w-0">
            <h3 className="m-0 text-base font-semibold">{titre}</h3>
            <p className="mt-1 mb-2 text-sm text-[var(--color-ink-soft)]">{sousTitre}</p>
            {note === null ? (
              <span className="text-sm text-[var(--color-ink-faint)]">Pas encore calculée</span>
            ) : (
              <Ecart note={note} avant={avant} quand={quand} locale={locale} />
            )}
          </div>
        </div>
        {reserve === undefined ? null : (
          <p className="mt-4 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            {reserve}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * La progression, en deux courbes.
 *
 * Tracée à la main en SVG plutôt qu'avec une bibliothèque : deux séries de douze points ne
 * justifient pas trois cents kilo-octets de graphiques, et une courbe qu'on dessine soi-même
 * garde les couleurs de la maison.
 *
 * L'échelle va de zéro à cent, toujours. Un cadrage resserré sur les valeurs réelles ferait
 * de trois points gagnés une envolée et de trois points perdus un effondrement : c'est le
 * moyen le plus courant de mentir avec un graphique, et il est d'autant plus efficace que
 * personne ne regarde l'axe. Les repères sont donc écrits, et les valeurs de départ et
 * d'arrivée avec eux — une courbe se lit de travers, deux chiffres ne se lisent pas de
 * travers.
 */
function Courbes({
  historique,
  locale,
}: {
  historique: TableauProps['historique']
  locale: string
}) {
  const points = historique.filter(
    (mesure) => mesure.seoScore !== null || mesure.geoScore !== null,
  )
  // Une seule mesure ne fait pas une courbe : on ne trace rien plutôt qu'un point isolé.
  if (points.length < 2) return null

  const largeur = 640
  const hauteur = 190
  const hautBas = 14
  // De la place à gauche pour les repères de l'échelle, qui ne doivent chevaucher personne.
  const gauche = 34
  const droite = 12
  const x = (index: number) =>
    gauche + (index * (largeur - gauche - droite)) / Math.max(1, points.length - 1)
  const y = (note: number) => hauteur - hautBas - (note / 100) * (hauteur - 2 * hautBas)

  const series = [
    { cle: 'seo' as const, nom: 'Référencement', teinte: 'var(--color-brand)' },
    { cle: 'geo' as const, nom: 'Moteurs IA', teinte: 'var(--color-accent)' },
  ]
  const lire = (mesure: (typeof points)[number], cle: 'seo' | 'geo'): Note =>
    cle === 'seo' ? mesure.seoScore : mesure.geoScore

  const premier = points[0]
  const dernier = points[points.length - 1]

  return (
    <Card>
      <CardBody>
        <h3 className="m-0 text-base font-semibold">Votre progression</h3>
        <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
          {points.length} analyse{points.length > 1 ? 's' : ''} depuis le{' '}
          {enClair(premier?.finishedAt ?? null, locale)}.
        </p>
        <svg
          viewBox={`0 0 ${largeur} ${hauteur}`}
          className="h-48 w-full"
          role="img"
          aria-label={`Évolution des notes entre le ${enClair(premier?.finishedAt ?? null, locale)} et le ${enClair(dernier?.finishedAt ?? null, locale)}`}
        >
          {[0, 50, 100].map((niveau) => (
            <g key={niveau}>
              <line
                x1={gauche}
                x2={largeur - droite}
                y1={y(niveau)}
                y2={y(niveau)}
                stroke="var(--color-line)"
                strokeWidth="1"
              />
              <text
                x={gauche - 8}
                y={y(niveau)}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-[var(--color-ink-faint)] text-[12px]"
              >
                {niveau}
              </text>
            </g>
          ))}
          {series.map((serie) => {
            const chemin = points
              .map((mesure, index) => {
                const note = lire(mesure, serie.cle)
                return note === null ? null : `${index === 0 ? 'M' : 'L'}${x(index)} ${y(note)}`
              })
              .filter((morceau) => morceau !== null)
              .join(' ')
            return (
              <g key={serie.cle}>
                <path
                  d={chemin}
                  fill="none"
                  stroke={serie.teinte}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Un point par analyse : sans eux, quatre mesures et quarante se ressemblent. */}
                {points.map((mesure, index) => {
                  const note = lire(mesure, serie.cle)
                  if (note === null) return null
                  return (
                    <circle
                      key={`${serie.cle}-${index}`}
                      cx={x(index)}
                      cy={y(note)}
                      r="3.5"
                      fill="var(--color-surface)"
                      stroke={serie.teinte}
                      strokeWidth="2.5"
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-[var(--color-ink-soft)]">
          {series.map((serie) => {
            const depart = lire(premier as (typeof points)[number], serie.cle)
            const arrivee = lire(dernier as (typeof points)[number], serie.cle)
            return (
              <li key={serie.cle} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: serie.teinte }}
                />
                {serie.nom}
                {depart === null || arrivee === null ? null : (
                  <span className="text-[var(--color-ink-faint)]">
                    {depart} → {arrivee}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

/**
 * Un chiffre, et ce qu'il compte.
 *
 * Gros, parce qu'il se lit d'un coup d'œil ; sans flèche ni pourcentage, parce qu'il n'y a
 * rien à comparer — c'est un état, pas une tendance. La teinte ne sert qu'à distinguer ce
 * qui presse de ce qui rassure ; par défaut il n'en a pas, et c'est bien ainsi pour un
 * nombre de pages.
 */
function Compteur({
  valeur,
  quoi,
  teinte,
}: {
  valeur: number
  quoi: string
  teinte?: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p
        className="m-0 text-3xl leading-none font-semibold"
        style={teinte === undefined ? undefined : { color: teinte }}
      >
        {valeur}
      </p>
      <p className="mt-1.5 mb-0 text-sm text-[var(--color-ink-soft)]">{quoi}</p>
    </div>
  )
}

export function TableauVisibilite({
  locale,
  site,
  audit,
  precedent,
  historique,
  lignes,
  reglees,
  cout,
  alertes,
}: TableauProps) {
  const aCorriger = lignes.length
  const critiques = lignes.filter((ligne) => ligne.severity === 'critical').length

  return (
    <div className="grid gap-6">
      {/*
        Ce qui est cassé passe avant les notes, et même avant Léa.
        
        Une note de soixante-neuf sur cent ne veut plus rien dire si le site ne répond plus
        ou vient de demander sa désindexation : ce sont des pannes qui effacent tout le
        reste, et elles ne se voient pas depuis le site, qui continue de s'afficher pour son
        propriétaire. Les reléguer sous les jauges reviendrait à les faire découvrir en
        dernier.
      */}
      {alertes.length === 0 ? null : (
        <section
          className="rounded-[var(--radius-card)] border p-5"
          style={{
            borderColor: 'var(--color-critical)',
            background: 'var(--color-critical-soft, var(--color-surface))',
          }}
        >
          <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--color-critical)' }}>
            {alertes.length === 1
              ? 'Un problème repéré depuis votre dernière analyse'
              : `${alertes.length} problèmes repérés depuis votre dernière analyse`}
          </h2>
          <ul className="m-0 mt-3 grid list-none gap-3 p-0">
            {alertes.map((alerte) => (
              <li key={`${alerte.checkId}-${alerte.detail}`}>
                <p className="m-0 text-sm font-medium">{alerte.label}</p>
                <p className="m-0 mt-0.5 text-sm text-[var(--color-ink-soft)]">{alerte.why}</p>
                {alerte.detail === '' ? null : (
                  <p className="m-0 mt-0.5 text-xs text-[var(--color-ink-faint)]">
                    {alerte.detail}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Léa ouvre l'écran. Ce qu'elle dit est entièrement calculé — nombre de pages, nombre
        de constats, date — et c'est justement ce qui permet de le dire sans précaution : il
        n'y a rien là-dedans qu'un modèle aurait pu inventer.
      */}
      <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <img
          src="/equipe/lea.webp"
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-base leading-relaxed">
            <strong>Léa</strong> a terminé l’analyse de <strong>{site.host}</strong> : {' '}
            {audit.pagesCrawled} {pluriel(audit.pagesCrawled, 'page')} {' '}
            {pluriel(audit.pagesCrawled, 'lue')}, {aCorriger} {pluriel(aCorriger, 'point')} à
            corriger
            {critiques === 0 ? '' : `, dont ${critiques} ${pluriel(critiques, 'critique')}`}.
          </p>
          {audit.finishedAt === null ? null : (
            <p className="mt-1 mb-0 text-sm text-[var(--color-ink-faint)]">
              Analysé le {enClair(audit.finishedAt, locale)}.
            </p>
          )}
          {/*
            Un audit interrompu rend de vrais résultats, mais sur une partie du site. Le taire
            reviendrait à présenter un score partiel comme un score complet.
          */}
          {audit.partiel ? (
            <p className="mt-1 mb-0 text-sm text-[var(--color-ink-faint)]">
              L’exploration s’est arrêtée avant d’avoir fait le tour du site : ces résultats
              portent sur les pages lues, pas sur l’ensemble. Relancez une analyse pour le
              site entier.
            </p>
          ) : null}
        </div>
      </div>

      {/*
        Trois chiffres, et seulement trois.
        
        C'est ce qu'on regarde en arrivant : combien de pages ont été lues, combien de points
        restent, combien sont déjà réglés. Aucun n'est estimé — ils se comptent tous sur ce
        que l'analyse a réellement trouvé, et c'est pour cela qu'on peut les afficher gros.
        
        Le troisième est celui qui manquait : une liste qui ne montre que ce qu'il reste à
        faire ne donne jamais l'impression d'avancer.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Compteur valeur={audit.pagesCrawled} quoi="pages analysées" />
        <Compteur
          valeur={aCorriger}
          quoi={critiques === 0 ? 'points à corriger' : `points à corriger, dont ${critiques} critique${critiques > 1 ? 's' : ''}`}
          teinte={critiques > 0 ? 'var(--color-critical)' : undefined}
        />
        <Compteur valeur={reglees.length} quoi="déjà réglés" teinte="var(--color-positive)" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CarteNote
          titre="Référencement"
          sousTitre="Ce qu’un moteur de recherche regarde sur vos pages."
          note={audit.seoScore}
          avant={precedent?.seoScore ?? null}
          quand={precedent?.finishedAt ?? null}
          teinte="var(--color-brand)"
          locale={locale}
        />
        <CarteNote
          titre="Moteurs IA"
          sousTitre="Ce qu’un assistant peut comprendre et reprendre de vos pages."
          note={audit.geoScore}
          avant={precedent?.geoScore ?? null}
          quand={precedent?.finishedAt ?? null}
          teinte="var(--color-accent)"
          locale={locale}
          reserve="Cette note mesure l’aptitude de vos pages à être reprises par un assistant. Elle ne garantit pas une apparition dans ChatGPT, Gemini ou Perplexity : personne n’en connaît les critères, et ils changent."
        />
      </div>

      <Courbes historique={historique} locale={locale} />

      <section>
        {/*
          Le titre seul, et plus les dix boutons qui l'accompagnaient.
          
          Ils offraient à plat dix destinations — vos pages dans Google, ce que les gens
          cherchent, votre boutique, quoi écrire, vos campagnes, les IA, l'automatique, un
          article, l'équipe, l'historique — sans hiérarchie ni ordre. On y trouvait tout, et
          rien du premier coup d'œil. Ils vivent désormais dans le menu de gauche, groupés et
          commentés, où ils ne concurrencent plus ce que cet écran a de propre : la liste de
          ce qu'il faut corriger.
        */}
        <div className="mb-4">
          <h2 className="m-0 text-lg font-semibold">Votre plan d’action</h2>
          <p className="mt-1 mb-0 text-sm text-[var(--color-ink-soft)]">
            Ce que Léa a relevé, du plus rentable au moins urgent.
          </p>
        </div>

        {lignes.length === 0 ? (
          <Card>
            <CardBody>
              <h3 className="m-0 text-base font-semibold">Rien à corriger pour l’instant</h3>
              <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
                Tous les contrôles applicables à ce site sont passés. Relancez une analyse après
                votre prochaine mise à jour.
              </p>
            </CardBody>
          </Card>
        ) : (
          <PlanAction siteId={site.id} lignes={lignes} locale={locale} cout={cout} />
        )}

        {/*
          Ce qui a disparu depuis qu'on l'a marqué traité. C'est le seul endroit du produit
          où quelqu'un voit que son travail a porté, et c'est vérifié par l'analyse suivante
          plutôt que déclaré : le constat n'est plus là.
        */}
        {reglees.length === 0 ? null : (
          <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <h3 className="m-0 text-base font-semibold">Réglé depuis</h3>
            <p className="mt-1 mb-3 text-sm text-[var(--color-ink-soft)]">
              Ces points ne remontent plus dans la dernière analyse.
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {reglees.map((reglee) => (
                <li
                  key={reglee.checkId}
                  className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1 text-sm text-[var(--color-ink-soft)]"
                >
                  {reglee.state === 'ignored' ? '— ' : '✓ '}
                  {reglee.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-4 mb-0 text-sm text-[var(--color-ink-faint)]">
          Les corrections rédigées par l’équipe arrivent dans une prochaine version. Evoliia ne
          modifie jamais votre site : vous gardez la main sur ce que vous appliquez.
        </p>
      </section>
    </div>
  )
}
