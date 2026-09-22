import { membre } from '@/lib/equipe'

/**
 * Le brief quotidien de MIRA, en haut de son écran.
 *
 * Il répond à la seule question qu'on se pose en ouvrant cet écran le matin : est-ce que
 * quelque chose a bougé hier ? Les chiffres du tableau, plus bas, répondent à « où en
 * suis-je », qui est une autre question et qu'on se pose moins souvent.
 *
 * Trois partis pris.
 *
 * **Il ne félicite pas.** Quand la dépense suit son cours, il le dit en une ligne et
 * s'arrête. Un brief qui rassure tous les matins finit par n'être plus lu, et c'est le
 * matin où il aurait fallu le lire qu'on ne le lit pas.
 *
 * **Il compare à la semaine, pas à la veille.** Un samedi n'est pas un mardi : l'écart d'un
 * jour à l'autre n'apprend rien, celui à la moyenne de sept jours apprend quelque chose.
 *
 * **Il parle d'hier.** La journée en cours est incomplète, et la compter ferait annoncer
 * chaque matin un effondrement de la dépense.
 */

export type BriefVu = {
  jour: string
  devise: string
  depense: number
  repere: number
  conversions: number
  valeur: number
  ecartDepense: number | null
  ecartNotable: boolean
  modifications: number
  urgences: number
  silencieux: boolean
}

function argent(montant: number, devise: string): string {
  return montant.toLocaleString('fr-CH', {
    style: 'currency',
    currency: devise === '' ? 'CHF' : devise,
    maximumFractionDigits: 2,
  })
}

function enClair(jour: string): string {
  const date = new Date(`${jour}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return jour
  return date.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function BriefMeta({ brief }: { brief: BriefVu }) {
  const mira = membre('meta')
  if (mira === undefined) return null

  /*
   * Rien ne diffuse, et rien n'a diffusé la semaine d'avant. On le dit franchement plutôt
   * que d'aligner des zéros : « 0,00 CHF dépensés » se lit comme une panne, alors que c'est
   * un choix — les campagnes sont en pause.
   */
  if (brief.silencieux) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Aucune diffusion hier, ni les sept jours précédents. {mira.name} n’a donc rien à
          rapporter : elle reprendra dès qu’une campagne dépensera.
        </p>
      </div>
    )
  }

  const hausse = brief.ecartDepense !== null && brief.ecartDepense > 0
  const pourcent =
    brief.ecartDepense === null ? null : Math.round(Math.abs(brief.ecartDepense) * 100)

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start gap-3">
        <img
          src={mira.avatar}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0">
          <p className="m-0 text-xs tracking-wide text-[var(--color-ink-faint)] uppercase">
            {enClair(brief.jour)}
          </p>
          <p className="mt-1 mb-0 text-sm leading-relaxed">
            <strong>{argent(brief.depense, brief.devise)}</strong> dépensés,{' '}
            {brief.conversions === 0
              ? 'aucune conversion'
              : `${brief.conversions.toLocaleString('fr-CH', { maximumFractionDigits: 1 })} conversion${brief.conversions > 1 ? 's' : ''} pour ${argent(brief.valeur, brief.devise)}`}
            .
          </p>

          {/*
            L'écart n'est dit que lorsqu'il dépasse ce qu'on tient pour du bruit. En deçà,
            l'annoncer chaque jour apprendrait à ne plus le lire.
          */}
          {pourcent === null || !brief.ecartNotable ? (
            <p className="mt-1 mb-0 text-sm text-[var(--color-ink-soft)]">
              La dépense suit son cours ({argent(brief.repere, brief.devise)} par jour en
              moyenne ces sept derniers jours).
            </p>
          ) : (
            <p
              className="mt-1 mb-0 text-sm font-medium"
              style={{ color: hausse ? 'var(--color-caution)' : 'var(--color-ink)' }}
            >
              {pourcent} % {hausse ? 'de plus' : 'de moins'} que la moyenne des sept jours
              précédents ({argent(brief.repere, brief.devise)} par jour).
            </p>
          )}

          {brief.modifications === 0 && brief.urgences === 0 ? null : (
            <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">
              {brief.modifications === 0
                ? ''
                : `${brief.modifications} modification${brief.modifications > 1 ? 's' : ''} en 24 h. `}
              {brief.urgences === 0
                ? ''
                : `${brief.urgences} constat${brief.urgences > 1 ? 's' : ''} urgent${brief.urgences > 1 ? 's' : ''} ouvert${brief.urgences > 1 ? 's' : ''} ci-dessous.`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
