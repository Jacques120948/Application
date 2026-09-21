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

import type { ReactNode } from 'react'
import { ActionsCampagne } from './ActionsCampagne'
import { CourbeAds, type JourneeVue } from './CourbeAds'

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
  /** Part de la dépense de la période, en pourcentage entier. */
  part: number
  /** Jours de diffusion réelle, pour que les comparaisons se lisent à leur juste valeur. */
  joursActifs: number
  joursActifsAvant: number
}

export type TableauVu = {
  devise: string
  jours: number
  depuis: string
  jusqua: string
  total: IndicateursVus
  ecarts: Record<string, EcartVu>
  campagnes: CampagneVue[]
  serie: JourneeVue[]
  tri: string
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
      <p className="mt-2 mb-0 text-xl font-semibold sm:text-2xl">{valeur}</p>
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

/** Un onglet de filtre : période ou ordre. Le même dessin pour les deux, c'est le même geste. */
function Onglet({
  href,
  actif,
  children,
}: {
  href: string
  actif: boolean
  children: ReactNode
}) {
  return (
    <a
      href={href}
      aria-current={actif ? 'true' : undefined}
      className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
        actif
          ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
      }`}
    >
      {children}
    </a>
  )
}

const TRIS: ReadonlyArray<{ cle: string; texte: string }> = [
  { cle: 'depense', texte: 'Dépense' },
  { cle: 'roas', texte: 'ROAS' },
  { cle: 'cpa', texte: 'Coût par vente' },
  { cle: 'nom', texte: 'Nom' },
]

/**
 * Une campagne, et la part du budget qu'elle prend.
 *
 * La barre de part est la seule chose ici qui ne soit pas dans les chiffres : voir que deux
 * campagnes sur sept consomment quatre-vingts pour cent de la dépense prend une seconde et
 * se lit mal dans une colonne de montants.
 */
function Campagne({
  campagne,
  devise,
  assiste,
  jours,
}: {
  campagne: CampagneVue
  devise: string
  /** Vrai quand le compte est en mode assisté : sans cela, aucune commande d'écriture. */
  assiste: boolean
  /** La durée de la période affichée, pour dire « 3 jours sur 30 ». */
  jours: number
}) {
  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-sm font-medium">{campagne.nom}</p>
        <p className="m-0 text-xs text-[var(--color-ink-faint)]">
          {TYPES[campagne.type] ?? campagne.type} ·{' '}
          {STATUTS[campagne.statut] ?? campagne.statut} · {montant(campagne.budget, devise)} /
          jour
        </p>
      </div>

      {campagne.part === 0 ? null : (
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-canvas)]"
            role="presentation"
          >
            <div
              className="h-full rounded-[var(--radius-pill)] bg-[var(--color-brand)]"
              style={{ width: `${Math.min(100, campagne.part)}%` }}
            />
          </div>
          <span className="text-xs text-[var(--color-ink-faint)]">
            {campagne.part} % de la dépense
          </span>
        </div>
      )}

      {/*
        Le nombre de jours de diffusion, quand il est loin de couvrir la période. Sans lui,
        « −395 points » d'une campagne relancée avant-hier se lit comme un effondrement
        alors que c'est une moyenne de trois jours en face d'une moyenne de trente.
      */}
      {campagne.joursActifs > 0 && campagne.joursActifs < jours ? (
        <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
          Diffusée {campagne.joursActifs} jour{campagne.joursActifs > 1 ? 's' : ''} sur{' '}
          {jours}
          {campagne.joursActifsAvant === 0
            ? ' — rien sur la période précédente, il n’y a donc rien à comparer.'
            : campagne.joursActifsAvant > campagne.joursActifs * 2
              ? ` — contre ${campagne.joursActifsAvant} sur la période précédente. Les comparaisons ci-dessous portent sur des durées très inégales.`
              : '.'}
        </p>
      ) : null}

      {campagne.budgetLimite ? (
        <p className="mt-2 mb-0 text-xs text-[var(--color-caution)]">
          Google signale que cette campagne est limitée par son budget : elle pourrait
          diffuser davantage.
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
            quoi: 'Coût par vente',
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
                <Mouvement ecart={cellule.ecart} suffixe="" mieuxEnHausse={cellule.mieux} />
              </p>
            )}
          </div>
        ))}
      </div>

      {assiste && campagne.statut !== 'REMOVED' ? (
        <ActionsCampagne
          campagneId={campagne.id}
          nom={campagne.nom}
          statut={campagne.statut}
          budget={campagne.budget}
          devise={devise}
        />
      ) : null}
    </li>
  )
}

export function TableauAds({
  tableau,
  base,
  assiste,
}: {
  tableau: TableauVu
  /** L'adresse de la page, pour que le choix de période voyage dedans. */
  base: string
  /** Vrai quand le compte est en mode assisté : les commandes d'écriture apparaissent alors. */
  assiste: boolean
}) {
  const { devise, total, ecarts } = tableau

  /*
   * Celles qui ont dépensé d'abord. Les autres existent et restent accessibles, mais plus
   * bas : une campagne en pause au milieu de celles qui tournent, avec six tirets à la place
   * de ses chiffres, fait chercher une panne là où il n'y en a pas.
   */
  const qui = tableau.campagnes.filter((campagne) => campagne.actuel.cout > 0)
  const dormantes = tableau.campagnes.filter((campagne) => campagne.actuel.cout === 0)

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
        {[1, 3, 7, 14, 30, 90].map((jours) => (
          <Onglet
            key={jours}
            href={`${base}?jours=${jours}&tri=${tableau.tri}`}
            actif={jours === tableau.jours}
          >
            {jours === 1 ? 'Hier' : `${jours} jours`}
          </Onglet>
        ))}
      </nav>

      {/*
        Deux colonnes dès le téléphone. Une colonne unique donnait six cartes hautes qu'il
        fallait faire défiler pour comparer la dépense au ROAS — c'est-à-dire pour faire la
        seule chose qu'on vient faire ici.
      */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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

      <CourbeAds serie={tableau.serie} devise={devise} />

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0 text-base font-semibold">Vos campagnes</h2>
          {qui.length <= 1 ? null : (
            <nav className="flex flex-wrap gap-2" aria-label="Ordre des campagnes">
              {TRIS.map((choix) => (
                <Onglet
                  key={choix.cle}
                  href={`${base}?jours=${tableau.jours}&tri=${choix.cle}`}
                  actif={choix.cle === tableau.tri}
                >
                  {choix.texte}
                </Onglet>
              ))}
            </nav>
          )}
        </div>
        {tableau.campagnes.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-ink-faint)]">
            Aucune campagne lue sur ce compte.
          </p>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-3 p-0">
              {qui.map((campagne) => (
                <Campagne
                  key={campagne.id}
                  campagne={campagne}
                  devise={devise}
                  assiste={assiste}
                  jours={tableau.jours}
                />
              ))}
            </ul>

            {dormantes.length === 0 ? null : (
              /*
                Repliées, pas retirées. Une campagne sans dépense est souvent celle dont on
                veut parler — en pause depuis trois semaines, budget épuisé, refusée par
                Google — et la faire disparaître de l'écran la ferait oublier. Mais la
                laisser au milieu des autres avec six tirets noie celles qui tournent.
              */
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-[var(--color-ink-soft)]">
                  {dormantes.length} campagne{dormantes.length > 1 ? 's' : ''} sans dépense sur
                  la période
                </summary>
                <ul className="m-0 mt-3 grid list-none gap-3 p-0">
                  {dormantes.map((campagne) => (
                    <Campagne
                      key={campagne.id}
                      campagne={campagne}
                      devise={devise}
                      assiste={assiste}
                      jours={tableau.jours}
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
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
