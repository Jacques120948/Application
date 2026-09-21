/**
 * Le tableau de bord publicitaire.
 *
 * Trois partis pris, chacun contre une façon de mal lire ces chiffres.
 *
 * **Un indicateur absent s'écrit « — », jamais « 0 ».** Une campagne sans dépense n'a pas un
 * ROAS de zéro : elle n'en a pas. Afficher zéro enverrait corriger une campagne qui n'a
 * simplement pas encore tourné.
 *
 * **Chaque chiffre porte son mouvement.** « ROAS 245 % » ne dit rien — personne ne sait si
 * c'est bon sans connaître sa marge et la semaine d'avant. La comparaison est affichée
 * partout où elle existe, et rien ne la remplace quand elle n'existe pas encore.
 *
 * **Le jargon est traduit sur place.** Les gens qu'Evoliia sert paient pour de la publicité,
 * ils n'ont pas à savoir lire l'interface de Google Ads. Chaque intitulé porte sa phrase.
 */

export type EcartVu = { valeur: number | null; variation: number | null; points: number | null }

export type IndicateursVus = {
  cout: number
  impressions: number
  clics: number
  conversions: number
  valeur: number
  roas: number | null
  cpa: number | null
  ctr: number | null
  cpc: number | null
  tauxConversion: number | null
}

export type CampagneVue = {
  id: string
  nom: string
  type: string
  statut: string
  budget: number
  budgetLimite: boolean
  actuel: IndicateursVus
  roas: EcartVu
  cpa: EcartVu
  cout: EcartVu
}

export type TableauVu = {
  devise: string
  jours: number
  depuis: string
  jusqua: string
  total: IndicateursVus
  ecarts: Record<string, EcartVu>
  campagnes: CampagneVue[]
  synchronise: boolean
}

/** Les types de campagne, dits en français. Le vocabulaire de Google reste en dessous. */
const TYPES: Record<string, string> = {
  SEARCH: 'Recherche',
  SHOPPING: 'Shopping',
  PERFORMANCE_MAX: 'Performance Max',
  DISPLAY: 'Display',
  VIDEO: 'Vidéo',
  DEMAND_GEN: 'Demand Gen',
}

const STATUTS: Record<string, string> = {
  ENABLED: 'Active',
  PAUSED: 'En pause',
}

function montant(valeur: number | null, devise: string): string {
  if (valeur === null) return '—'
  return `${valeur.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`
}

function pourcent(valeur: number | null): string {
  return valeur === null ? '—' : `${valeur} %`
}

/**
 * Le mouvement d'un chiffre.
 *
 * Dit avec un mot, pas seulement une flèche : « en hausse » se lit à haute voix, une flèche
 * rouge ne se lit pas du tout pour qui ne distingue pas les couleurs. Et le sens du bien
 * n'est pas universel — un CPA qui monte est une mauvaise nouvelle, un ROAS qui monte une
 * bonne — d'où `mieuxEnHausse`.
 */
function Mouvement({
  ecart,
  suffixe,
  mieuxEnHausse,
}: {
  ecart: EcartVu
  suffixe: string
  mieuxEnHausse: boolean
}) {
  const chiffre = ecart.points ?? ecart.variation
  if (chiffre === null || chiffre === 0) {
    return (
      <span className="text-xs text-[var(--color-ink-faint)]">
        {chiffre === 0 ? 'stable' : 'pas de période précédente'}
      </span>
    )
  }
  const monte = chiffre > 0
  const bon = monte === mieuxEnHausse
  return (
    <span
      className="text-xs"
      style={{ color: bon ? 'var(--color-positive)' : 'var(--color-critical)' }}
    >
      {monte ? '+' : ''}
      {chiffre}
      {ecart.points === null ? ' %' : ' point'}
      {ecart.points !== null && Math.abs(chiffre) > 1 ? 's' : ''} {suffixe}
    </span>
  )
}

function Carte({
  titre,
  valeur,
  quoi,
  ecart,
  mieuxEnHausse = true,
}: {
  titre: string
  valeur: string
  quoi: string
  ecart?: EcartVu
  mieuxEnHausse?: boolean
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        {titre}
      </p>
      <p className="mt-2 mb-0 text-2xl font-semibold">{valeur}</p>
      {ecart === undefined ? null : (
        <p className="mt-1 mb-0">
          <Mouvement
            ecart={ecart}
            suffixe="sur la période précédente"
            mieuxEnHausse={mieuxEnHausse}
          />
        </p>
      )}
      <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">{quoi}</p>
    </div>
  )
}

export function TableauAds({
  tableau,
  base,
}: {
  tableau: TableauVu
  /** L'adresse de la page, pour que le choix de période voyage dedans. */
  base: string
}) {
  const { devise, total, ecarts } = tableau

  if (!tableau.synchronise) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed">
          Vos campagnes n’ont pas encore été lues. La première lecture a lieu cette nuit, et
          elle remonte quatre-vingt-dix jours pour qu’il y ait de quoi comparer dès le
          premier écran.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <nav className="flex flex-wrap gap-2" aria-label="Période">
        {[1, 3, 7, 14, 30].map((jours) => {
          const actif = jours === tableau.jours
          return (
            <a
              key={jours}
              href={`${base}?jours=${jours}`}
              aria-current={actif ? 'true' : undefined}
              className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
                actif
                  ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
              }`}
            >
              {jours === 1 ? 'Hier' : `${jours} jours`}
            </a>
          )
        })}
      </nav>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Carte
          titre="Dépenses"
          valeur={montant(total.cout, devise)}
          quoi="Ce que vous avez payé à Google sur la période."
          ecart={ecarts.cout}
          mieuxEnHausse={false}
        />
        <Carte
          titre="Valeur générée"
          valeur={montant(total.valeur, devise)}
          quoi="Ce que vos conversions ont rapporté, tel que Google le mesure."
          ecart={ecarts.valeur}
        />
        <Carte
          titre="ROAS"
          valeur={pourcent(total.roas)}
          quoi="Ce que rapporte chaque franc dépensé en publicité. 200 % veut dire deux francs gagnés pour un franc dépensé."
          ecart={ecarts.roas}
        />
        <Carte
          titre="Conversions"
          valeur={total.conversions === 0 ? '0' : String(total.conversions)}
          quoi="Les ventes ou contacts obtenus, tels que Google les compte."
          ecart={ecarts.conversions}
        />
        <Carte
          titre="CPA"
          valeur={montant(total.cpa, devise)}
          quoi="Ce que vous coûte en moyenne une vente ou un contact."
          ecart={ecarts.cpa}
          mieuxEnHausse={false}
        />
        <Carte
          titre="CTR"
          valeur={pourcent(total.ctr)}
          quoi="La part des gens qui cliquent après avoir vu votre annonce."
          ecart={ecarts.ctr}
        />
      </section>

      <section className="grid grid-cols-2 divide-x divide-[var(--color-line)] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] sm:grid-cols-4">
        {[
          { quoi: 'Impressions', valeur: total.impressions.toLocaleString('fr-CH') },
          { quoi: 'Clics', valeur: total.clics.toLocaleString('fr-CH') },
          { quoi: 'Coût par clic', valeur: montant(total.cpc, devise) },
          { quoi: 'Clics qui convertissent', valeur: pourcent(total.tauxConversion) },
        ].map((ligne) => (
          <div key={ligne.quoi} className="px-4 py-3">
            <p className="m-0 text-lg font-semibold">{ligne.valeur}</p>
            <p className="m-0 mt-0.5 text-xs text-[var(--color-ink-faint)]">{ligne.quoi}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="m-0 mb-3 text-base font-semibold">Vos campagnes</h2>
        {tableau.campagnes.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-ink-faint)]">
            Aucune campagne lue sur ce compte.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {tableau.campagnes.map((campagne) => (
              <li
                key={campagne.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 text-sm font-medium">{campagne.nom}</p>
                  <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                    {TYPES[campagne.type] ?? campagne.type} ·{' '}
                    {STATUTS[campagne.statut] ?? campagne.statut} ·{' '}
                    {montant(campagne.budget, devise)} / jour
                  </p>
                </div>

                {campagne.budgetLimite ? (
                  <p className="mt-2 mb-0 text-xs text-[var(--color-caution)]">
                    Google signale que cette campagne est limitée par son budget : elle
                    pourrait diffuser davantage.
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {
                      quoi: 'Dépenses',
                      valeur: montant(campagne.actuel.cout, devise),
                      ecart: campagne.cout,
                      mieux: false,
                    },
                    {
                      quoi: 'ROAS',
                      valeur: pourcent(campagne.actuel.roas),
                      ecart: campagne.roas,
                      mieux: true,
                    },
                    {
                      quoi: 'CPA',
                      valeur: montant(campagne.actuel.cpa, devise),
                      ecart: campagne.cpa,
                      mieux: false,
                    },
                    {
                      quoi: 'Conversions',
                      valeur: String(campagne.actuel.conversions),
                      ecart: undefined,
                      mieux: true,
                    },
                  ].map((cellule) => (
                    <div key={cellule.quoi}>
                      <p className="m-0 text-sm font-medium">{cellule.valeur}</p>
                      <p className="m-0 text-xs text-[var(--color-ink-faint)]">{cellule.quoi}</p>
                      {cellule.ecart === undefined ? null : (
                        <p className="m-0 mt-0.5">
                          <Mouvement
                            ecart={cellule.ecart}
                            suffixe=""
                            mieuxEnHausse={cellule.mieux}
                          />
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Chiffres de Google Ads du {tableau.depuis} au {tableau.jusqua}, dans le fuseau de
        votre compte. La journée en cours n’y est pas : elle est incomplète, et l’inclure
        ferait plonger tous les indicateurs chaque matin. Google révise ses conversions
        pendant quelques jours — les chiffres récents peuvent encore bouger.
      </p>
    </div>
  )
}
