import type { ReactNode } from 'react'

/**
 * Ce que les chiffres valent, une fois confrontés à ce que la personne vise.
 *
 * C'est la bande qui transforme une rangée de nombres en phrase. « ROAS 245 % » ne se juge
 * pas ; « 245 %, alors qu'il vous en faut 250 pour rentrer dans vos frais » se juge en une
 * seconde, et c'est la seule chose que le commerçant voulait savoir en ouvrant la page.
 *
 * Deux partis pris.
 *
 * **Un profil vide n'affiche pas un tableau de bord vide, il affiche la question.** Tant que
 * la marge n'est pas connue, aucun verdict n'est possible — et le dire, avec le champ à
 * remplir juste en dessous, vaut mieux que six cases à tirets qu'on prendrait pour une panne.
 *
 * **Le bénéfice porte ses réserves à côté de lui, pas dans une note de bas de page.** Il ne
 * tient compte ni des retours, ni des frais de port, ni des ventes que Google n'a pas vues.
 * Un chiffre qui ressemble à un résultat comptable et n'en est pas doit dire ce qu'il n'est
 * pas, à l'endroit où on le lit.
 */

export type RythmeBudgetVu = {
  budget: number
  depense: number
  joursEcoules: number
  joursDuMois: number
  projection: number | null
  consomme: number
}

export type LectureVue = {
  devise: string
  seuil: number | null
  roas: number | null
  verdict: 'rentable' | 'equilibre' | 'perte' | 'inconnu'
  ecartSeuil: number | null
  benefice: number | null
  roasCible: number | null
  ecartCible: number | null
  cpa: number | null
  cpaCible: number | null
  ecartCpa: number | null
  budget: RythmeBudgetVu | null
}

function montant(valeur: number | null, devise: string): string {
  if (valeur === null) return '—'
  const signe = valeur < 0 ? '−' : ''
  return `${signe}${Math.abs(valeur).toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

function points(valeur: number): string {
  return `${Math.abs(valeur)} point${Math.abs(valeur) > 1 ? 's' : ''}`
}

const VERDICTS: Record<LectureVue['verdict'], { mot: string; couleur: string }> = {
  rentable: { mot: 'Rentable', couleur: 'var(--color-positive)' },
  equilibre: { mot: 'À l’équilibre', couleur: 'var(--color-caution)' },
  perte: { mot: 'À perte', couleur: 'var(--color-critical)' },
  inconnu: { mot: 'Indéterminé', couleur: 'var(--color-ink-faint)' },
}

function Bloc({ titre, valeur, children }: { titre: string; valeur: string; children: ReactNode }) {
  return (
    <div>
      <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        {titre}
      </p>
      <p className="mt-1.5 mb-0 text-2xl font-semibold">{valeur}</p>
      <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">{children}</p>
    </div>
  )
}

export function ObjectifsAds({
  lecture,
  marge,
  jours,
  /** L'ancre du formulaire, pour que « renseignez votre marge » mène quelque part. */
  ancre,
}: {
  lecture: LectureVue
  /** La marge déclarée, en pourcentage. Zéro : non renseignée. */
  marge: number
  jours: number
  ancre: string
}) {
  const duree = jours === 1 ? 'hier' : `sur ${jours} jours`

  if (lecture.seuil === null) {
    return (
      <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm font-medium">Rentable ou pas ? Naya ne peut pas encore le dire.</p>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Un ROAS ne se juge pas tout seul. À 40 % de marge, il vous faut 250 % pour rentrer
          dans vos frais ; à 20 %, il vous en faut 500. C’est votre marge qui tranche, et elle
          n’appartient qu’à vous — Google ne la connaît pas.
        </p>
        <a
          href={ancre}
          className="mt-3 inline-flex items-center rounded-[var(--radius-pill)] border border-[var(--color-line)] px-4 py-2 text-sm no-underline"
        >
          Renseigner ma marge
        </a>
      </section>
    )
  }

  const verdict = VERDICTS[lecture.verdict]

  return (
    <section className="grid gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">Vos objectifs</h2>
        <span
          className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-medium"
          style={{ color: verdict.couleur, backgroundColor: 'var(--color-canvas)' }}
        >
          {verdict.mot} {duree}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Bloc titre="Seuil de rentabilité" valeur={`${lecture.seuil} %`}>
          En dessous, chaque franc dépensé vous coûte plus qu’il ne rapporte. Déduit de votre
          marge de {marge} %.
        </Bloc>

        <Bloc
          titre="ROAS constaté"
          valeur={lecture.roas === null ? '—' : `${lecture.roas} %`}
        >
          {lecture.ecartSeuil === null ? (
            <>Aucune dépense sur la période : il n’y a rien à juger.</>
          ) : lecture.ecartSeuil === 0 ? (
            <>Exactement au seuil : la publicité se paie, sans plus.</>
          ) : lecture.ecartSeuil > 0 ? (
            <>{points(lecture.ecartSeuil)} au-dessus de votre seuil.</>
          ) : (
            <>{points(lecture.ecartSeuil)} en dessous de votre seuil.</>
          )}
        </Bloc>

        <Bloc titre="Ce qu’il vous reste" valeur={montant(lecture.benefice, lecture.devise)}>
          Votre marge sur ce que Google a vu vendre, moins ce que vous avez payé à Google.
          Hors retours, frais d’expédition et ventes que Google n’attribue pas.
        </Bloc>
      </div>

      {lecture.roasCible === null && lecture.cpaCible === null && lecture.budget === null ? null : (
        <div className="grid gap-2 border-t border-[var(--color-line)] pt-4">
          {lecture.roasCible === null ? null : (
            <p className="m-0 text-sm leading-relaxed">
              <span className="text-[var(--color-ink-soft)]">ROAS visé : </span>
              {lecture.roasCible} %.{' '}
              {lecture.ecartCible === null ? (
                <span className="text-[var(--color-ink-faint)]">
                  Rien à comparer sur cette période.
                </span>
              ) : lecture.ecartCible >= 0 ? (
                <span style={{ color: 'var(--color-positive)' }}>
                  Atteint, et dépassé de {points(lecture.ecartCible)}.
                </span>
              ) : (
                <span style={{ color: 'var(--color-caution)' }}>
                  Il vous manque {points(lecture.ecartCible)}.
                </span>
              )}
            </p>
          )}

          {lecture.cpaCible === null ? null : (
            <p className="m-0 text-sm leading-relaxed">
              <span className="text-[var(--color-ink-soft)]">Coût par vente accepté : </span>
              {montant(lecture.cpaCible, lecture.devise)}.{' '}
              {lecture.ecartCpa === null ? (
                <span className="text-[var(--color-ink-faint)]">
                  Aucune conversion sur cette période.
                </span>
              ) : lecture.ecartCpa <= 0 ? (
                <span style={{ color: 'var(--color-positive)' }}>
                  Vous êtes en dessous de {montant(Math.abs(lecture.ecartCpa), lecture.devise)}.
                </span>
              ) : (
                <span style={{ color: 'var(--color-caution)' }}>
                  Vous le dépassez de {montant(lecture.ecartCpa, lecture.devise)}.
                </span>
              )}
            </p>
          )}

          {lecture.budget === null ? null : <Budget budget={lecture.budget} devise={lecture.devise} />}
        </div>
      )}
    </section>
  )
}

/**
 * Le budget du mois, et le rythme qui y mène ou non.
 *
 * La barre est plafonnée visuellement à cent pour cent mais le chiffre ne l'est pas : une
 * barre qui déborderait de son cadre serait un défaut d'affichage, un « 142 % » qui
 * disparaîtrait serait un mensonge.
 */
function Budget({ budget, devise }: { budget: RythmeBudgetVu; devise: string }) {
  const depasse = budget.projection !== null && budget.projection > budget.budget
  return (
    <div>
      <p className="m-0 text-sm leading-relaxed">
        <span className="text-[var(--color-ink-soft)]">Budget du mois : </span>
        {montant(budget.depense, devise)} dépensés sur {montant(budget.budget, devise)} (
        {budget.consomme} %), en {budget.joursEcoules} jour
        {budget.joursEcoules > 1 ? 's' : ''} sur {budget.joursDuMois}.
      </p>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-canvas)]"
        role="presentation"
      >
        <div
          className="h-full rounded-[var(--radius-pill)]"
          style={{
            width: `${Math.min(100, budget.consomme)}%`,
            backgroundColor: depasse ? 'var(--color-caution)' : 'var(--color-brand)',
          }}
        />
      </div>
      {budget.projection === null ? (
        <p className="mt-1.5 mb-0 text-xs text-[var(--color-ink-faint)]">
          Le mois vient de commencer : il n’y a pas encore de rythme à projeter.
        </p>
      ) : (
        <p
          className="mt-1.5 mb-0 text-xs leading-relaxed"
          style={{ color: depasse ? 'var(--color-caution)' : 'var(--color-ink-faint)' }}
        >
          À ce rythme, {montant(budget.projection, devise)} d’ici la fin du mois
          {depasse
            ? ` — ${montant(budget.projection - budget.budget, devise)} de plus que prévu.`
            : '.'}
        </p>
      )}
    </div>
  )
}
