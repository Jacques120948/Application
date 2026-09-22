import { membre } from '@/lib/equipe'
import { Card, CardBody } from '@/components/ui'

/**
 * Les blocs propres à l'écran de Cleo.
 *
 * Ils ne sont pas dans `TableauVisibilite` parce qu'ils ne disent pas la même chose. Les
 * deux notes du tableau de bord mesurent une aptitude technique ; celle-ci mesure ce qui
 * manque à une page pour qu'on ose décider dessus, et elle porte donc une réserve que les
 * autres n'ont pas besoin de porter.
 *
 * **La réserve n'est pas une précaution d'avocat.** Un chiffre sur cent, sur un écran qui
 * s'appelle « conversion », se lit comme un taux de conversion. Ce n'en est pas un : rien
 * n'est relié qui mesurerait une vente. Le dire sous le chiffre est le seul endroit où
 * cela soit lu.
 *
 * Les dates arrivent en chaînes ISO plutôt qu'en `Date` : ces blocs sont rendus par des
 * pages serveur, et une `Date` traversant la frontière ressort en chaîne de toute façon.
 */

type Note = number | null

/** Une date écrite comme on la dit. */
function enClair(iso: string | null, locale: string): string {
  if (iso === null || iso === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : locale, {
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function pluriel(nombre: number, singulier: string, pluriel_ = `${singulier}s`): string {
  return nombre > 1 ? pluriel_ : singulier
}

/**
 * Le mot d'ouverture de Cleo.
 *
 * Tout ce qu'il contient est compté : le nombre de pages lues, le nombre de constats, la
 * date. C'est ce qui permet de l'écrire à la première personne sans rien inventer — il n'y
 * a là-dedans aucune phrase qu'un modèle aurait produite.
 *
 * Le portrait vient de la fiche d'équipe plutôt que d'un chemin écrit ici : c'est le même
 * visage que dans le menu, et il n'y a qu'un endroit à changer. Sans portrait, la pastille
 * à initiale prend le relais, comme partout ailleurs.
 */
export function MotDeCleo({
  hote,
  pages,
  aTraiter,
  finishedAt,
  locale,
  href,
}: {
  hote: string
  pages: number
  aTraiter: number
  finishedAt: string | null
  locale: string
  /** Où lui parler. */
  href: string
}) {
  const date = enClair(finishedAt, locale)
  const portrait = membre('cro')?.avatar
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      {portrait === undefined ? (
        <span
          aria-hidden="true"
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
          style={{ backgroundColor: 'var(--color-accent-soft, var(--color-brand-soft))' }}
        >
          C
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portrait}
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 rounded-full object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="m-0 text-base leading-relaxed">
          <strong>Cleo</strong> a relu {pages} {pluriel(pages, 'page')} de{' '}
          <strong>{hote}</strong>
          {aTraiter === 0
            ? ' et n’y a rien trouvé qui freine une décision.'
            : ` : ${aTraiter} ${pluriel(aTraiter, 'point')} ${pluriel(aTraiter, 'peut', 'peuvent')} faire hésiter un visiteur.`}
        </p>
        {date === '' ? null : (
          <p className="mt-1 mb-0 text-sm text-[var(--color-ink-faint)]">Analysé le {date}.</p>
        )}
      </div>
      <a
        href={href}
        className="shrink-0 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-1.5 text-sm no-underline"
      >
        Lui parler
      </a>
    </div>
  )
}

/** La jauge, reprise du tableau de bord pour que les notes se lisent de la même façon. */
function Anneau({ note }: { note: number }) {
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
        stroke="var(--color-accent)"
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

/**
 * Le score Cleo, avec ce qu'il n'est pas.
 *
 * Nulle sur un audit antérieur à Cleo, et c'est dit : « pas encore mesuré » n'est pas
 * « mesuré à zéro ». Afficher zéro ferait paraître catastrophique un site qui n'a
 * simplement pas encore été relu de ce point de vue.
 */
export function AnneauConversion({
  note,
  avant,
  quand,
  locale,
}: {
  note: Note
  avant: Note
  quand: string | null
  locale: string
}) {
  const date = enClair(quand, locale)
  const delta = note === null || avant === null ? null : note - avant

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-5">
          {note === null ? (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-8 border-[var(--color-line)] text-sm text-[var(--color-ink-faint)]">
              —
            </div>
          ) : (
            <Anneau note={note} />
          )}
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold">Score Cleo</h2>
            <p className="mt-1 mb-2 text-sm text-[var(--color-ink-soft)]">
              Ce qu’une page donne à un visiteur pour décider.
            </p>
            {note === null ? (
              <span className="text-sm text-[var(--color-ink-faint)]">
                Pas encore mesuré. La prochaine analyse la calculera.
              </span>
            ) : delta === null ? (
              <span className="text-sm text-[var(--color-ink-faint)]">Première mesure</span>
            ) : delta === 0 ? (
              <span className="text-sm text-[var(--color-ink-faint)]">
                Inchangé{date === '' ? '' : ` depuis le ${date}`}
              </span>
            ) : (
              <span
                className="text-sm font-medium"
                style={{
                  color: delta > 0 ? 'var(--color-brand-strong)' : 'var(--color-critical)',
                }}
              >
                {delta > 0 ? '+' : '−'}
                {Math.abs(delta)} {pluriel(Math.abs(delta), 'point')}
                {date === '' ? '' : ` depuis le ${date}`}
              </span>
            )}
          </div>
        </div>
        <p className="mt-4 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Cette note est un indicateur interne Evoliia, pas une mesure scientifique. Elle
          compte ce qui manque à vos pages pour qu’on y décide — elle ne mesure aucune vente,
          aucun panier, aucun abandon : rien de tout cela n’est relié à Evoliia aujourd’hui.
        </p>
      </CardBody>
    </Card>
  )
}

const GRAVITES: Record<string, { label: string; fond: string; texte: string }> = {
  critical: {
    label: 'Critique',
    fond: 'var(--color-critical-soft)',
    texte: 'var(--color-critical)',
  },
  important: { label: 'Important', fond: 'var(--color-accent-soft)', texte: 'var(--color-accent)' },
  improvement: {
    label: 'Amélioration',
    fond: 'var(--color-brand-soft)',
    texte: 'var(--color-brand-strong)',
  },
}

/**
 * Un constat, montré pour être lu et non pour être coché.
 *
 * Le plan d'action plus bas porte les états ; ici on explique. La portée n'est écrite que
 * pour les contrôles de page : « une page sur une » n'a aucun sens pour un contrôle qui
 * porte sur le site entier, et l'écran préfère se taire qu'inventer un dénominateur.
 */
export function CarteConstat({
  rang,
  label,
  why,
  severity,
  affected,
  examined,
  scope,
  sample,
}: {
  /** Son rang parmi les priorités, quand il en a un. */
  rang?: number
  label: string
  why: string
  severity: string
  affected: number
  examined: number
  scope: string
  sample: readonly { path: string; url: string; title: string }[]
}) {
  const gravite = GRAVITES[severity]
  const exemple = sample[0]

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center gap-2">
        {rang === undefined ? null : (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-canvas)] text-xs font-semibold">
            {rang}
          </span>
        )}
        <h3 className="m-0 text-base font-semibold">{label}</h3>
        {gravite === undefined ? null : (
          <span
            className="rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: gravite.fond, color: gravite.texte }}
          >
            {gravite.label}
          </span>
        )}
      </div>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">{why}</p>
      {scope !== 'page' || examined === 0 ? null : (
        <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
          {affected} {pluriel(affected, 'page')} sur {examined} {pluriel(examined, 'analysée')}
          {exemple === undefined ? '' : ` — par exemple ${exemple.path}`}
        </p>
      )}
    </div>
  )
}
