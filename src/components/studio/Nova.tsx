import { membre } from '@/lib/equipe'
import { PERIODES } from '@/lib/nova'
import { Badge, Card, CardBody, LinkButton } from '@/components/ui'
import type { Kpi, LigneCampagne, LigneCanal, LigneProduit, Attribution } from '@/server/nova/metriques'
import type { Alerte, Insight, Opportunite, RapportOria } from '@/server/nova/analyse'
import type { LigneSante } from '@/server/nova/service'
import type { Marge, SuiviObjectif } from '@/server/nova/pilotage'
import type { LigneModele, Modele, RepartitionClients, ValeurClient } from '@/server/nova/clients'
import type { Bilan } from '@/server/nova/bilan'
import type { CumulVisites } from '@/server/nova/metriques'
import type { Contenus } from '@/server/nova/contenus'
import { DelegationOria } from './DelegationOria'

/**
 * Les blocs de l'écran de Nova.
 *
 * Rendus par le serveur, sans état : on lit, on ne manipule pas. Chaque bloc répond d'abord
 * à « qu'est-ce que je dois comprendre ? », puis renvoie vers qui peut agir. Nova mesure ;
 * ce sont les autres qui changent quelque chose.
 *
 * **Des cartes, pas des tableaux.** Evoliia s'utilise beaucoup sur téléphone, et un tableau
 * de huit colonnes y devient une bande qu'on fait défiler de côté sans rien comprendre.
 * Chaque ligne de chiffres est une carte, qui s'empile sur un petit écran et s'aligne sur
 * un grand.
 *
 * **Un tiret n'est jamais un zéro.** Ce qui n'est pas mesuré s'affiche « — », avec la
 * raison à côté. Afficher 0 là où l'on ne sait pas serait la faute la plus facile et la plus
 * grave de l'écran.
 */

// ── Formats ──────────────────────────────────────────────────────────────────

function nombre(valeur: number, decimales = 0): string {
  return new Intl.NumberFormat('fr-CH', { maximumFractionDigits: decimales }).format(valeur)
}

export function argent(valeur: number | null, devise: string): string {
  if (valeur === null) return '—'
  return `${devise} ${nombre(valeur, Math.abs(valeur) < 100 ? 2 : 0)}`
}

function formater(kpi: Pick<Kpi, 'valeur' | 'format'>, devise: string): string {
  if (kpi.valeur === null) return '—'
  if (kpi.format === 'argent') return argent(kpi.valeur, devise)
  // Un taux de conversion se lit à la décimale : 1,8 % et 2,4 % ne racontent pas la même boutique.
  if (kpi.format === 'pourcent') return `${nombre(kpi.valeur, Math.abs(kpi.valeur) < 10 ? 1 : 0)} %`
  return nombre(kpi.valeur, 1)
}

/** Une variation, avec son signe et sa couleur selon ce qui est une bonne nouvelle. */
function Variation({ valeur, mieux }: { valeur: number | null; mieux: Kpi['mieux'] }) {
  if (valeur === null) return <span className="text-xs text-[var(--color-ink-faint)]">pas de comparaison</span>
  const arrondi = Math.round(valeur * 10) / 10
  if (arrondi === 0) return <span className="text-xs text-[var(--color-ink-soft)]">stable</span>
  const bon = mieux === 'neutre' ? null : (arrondi > 0) === (mieux === 'hausse')
  const couleur = bon === null ? 'var(--color-ink-soft)' : bon ? 'var(--color-positive)' : 'var(--color-critical)'
  return (
    <span className="text-xs font-medium tabular-nums" style={{ color: couleur }}>
      {arrondi > 0 ? '+' : '−'}
      {nombre(Math.abs(arrondi), 1)} %
    </span>
  )
}

function Portrait({ taille }: { taille: number }) {
  const nova = membre('nova')
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={nova?.avatar ?? '/equipe/nova.webp'}
      alt=""
      width={taille}
      height={taille}
      className="shrink-0 rounded-full object-cover"
      style={{ width: taille, height: taille }}
    />
  )
}

// ── En-tête et accueil ───────────────────────────────────────────────────────

export function EnteteNova({ versChiffres, versConversation }: { versChiffres: string; versConversation: string }) {
  return (
    <section
      className="on-night rounded-[var(--radius-card)] border border-[var(--color-night-line)] p-5 text-white sm:p-6"
      style={{ background: 'var(--gradient-night)' }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Portrait taille={72} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold tracking-[0.2em] text-white/70 uppercase">Nova</p>
          <h1 className="m-0 mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">Analytics & Performance</h1>
        </div>
      </div>
      <p className="mt-4 mb-0 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
        Je rassemble vos données marketing, publicitaires et commerciales pour vous montrer ce qui fonctionne, ce qui
        coûte et ce qui rapporte réellement.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <LinkButton href={versChiffres}>Voir mes chiffres</LinkButton>
        <a
          href={versConversation}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/30 px-4 py-2 text-sm font-medium text-white no-underline hover:border-white/60"
        >
          Parler à Nova
        </a>
      </div>
    </section>
  )
}

/** La première ouverture, quand rien n'est relié : Nova le dit et propose une seule chose. */
export function AccueilNova({ versConnexions }: { versConnexions: string }) {
  return (
    <Card>
      <CardBody>
        <p className="m-0 text-base leading-relaxed">
          Bonjour, je suis <strong>Nova</strong> 👋
        </p>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Je suis l’experte Analytics de votre équipe Evoliia. Je rassemble vos données marketing et commerciales pour
          vous montrer ce qui fonctionne réellement.
        </p>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Commençons par connecter vos principales sources de données : votre boutique Shopify pour les ventes réelles,
          Google Ads et Meta Ads pour les dépenses, Search Console pour vos clics Google.
        </p>
        <div className="mt-5">
          <LinkButton href={versConnexions}>Analyser mes performances</LinkButton>
        </div>
      </CardBody>
    </Card>
  )
}

// ── Période ──────────────────────────────────────────────────────────────────

/**
 * Le choix de la période, sans script : des liens, et un formulaire pour la période
 * personnalisée. Changer de période relit la base, jamais une plateforme.
 */
export function PeriodeNova({
  courante,
  libelle,
  du,
  au,
  base,
}: {
  courante: string
  libelle: string
  du: string
  au: string
  base: { chemin: string; siteId: string }
}) {
  const lien = (cle: string) => `${base.chemin}?periode=${cle}${base.siteId === '' ? '' : `&siteId=${base.siteId}`}`
  return (
    <div className="grid gap-2">
      <nav className="flex flex-wrap gap-2" aria-label="Période">
        {PERIODES.map((periode) => (
          <a
            key={periode.cle}
            href={lien(periode.cle)}
            aria-current={periode.cle === courante ? 'page' : undefined}
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
              periode.cle === courante
                ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
            }`}
          >
            {periode.label}
          </a>
        ))}
        <details className="relative">
          <summary
            className={`cursor-pointer list-none rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs ${
              courante === 'perso'
                ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
            }`}
          >
            Période personnalisée
          </summary>
          <form method="get" action={base.chemin} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="periode" value="perso" />
            {base.siteId === '' ? null : <input type="hidden" name="siteId" value={base.siteId} />}
            <label className="grid gap-1 text-xs text-[var(--color-ink-soft)]">
              Du
              <input type="date" name="du" defaultValue={du} className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2 py-1 text-sm" />
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-ink-soft)]">
              Au
              <input type="date" name="au" defaultValue={au} className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-1.5 text-xs">
              Afficher
            </button>
          </form>
        </details>
      </nav>
      <p className="m-0 text-xs text-[var(--color-ink-soft)]">
        {libelle} · comparé à la période de même durée juste avant
      </p>
    </div>
  )
}

// ── Indicateurs ──────────────────────────────────────────────────────────────

/** L'ordre des cartes, celui qu'on veut voir en premier sur un téléphone. */
const ORDRE: readonly Kpi['cle'][] = ['chiffre', 'roas', 'cac', 'commandes', 'depenses', 'mer', 'cpa', 'panier', 'conversion']

export function IndicateursNova({
  kpis,
  devise,
  ordre = ORDRE,
}: {
  kpis: readonly Kpi[]
  devise: string
  ordre?: readonly Kpi['cle'][]
}) {
  const ranges = ordre.map((cle) => kpis.find((kpi) => kpi.cle === cle)).filter((kpi): kpi is Kpi => kpi !== undefined)
  return (
    <section id="chiffres" className="scroll-mt-6">
      <h2 className="sr-only">Vos chiffres</h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {ranges.map((kpi) => (
          <li
            key={kpi.cle}
            className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
          >
            <span className="text-xs text-[var(--color-ink-soft)]">{kpi.label}</span>
            <span className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{formater(kpi, devise)}</span>
            {kpi.valeur === null ? (
              <span className="text-xs leading-snug text-[var(--color-ink-faint)]">{kpi.absent}</span>
            ) : (
              <>
                <Variation valeur={kpi.variation} mieux={kpi.mieux} />
                <span className="text-[11px] leading-snug text-[var(--color-ink-faint)]">{kpi.source}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Alertes et constats ──────────────────────────────────────────────────────

const NIVEAU: Record<Alerte['niveau'], { label: string; ton: 'critical' | 'caution' | 'positive'; pastille: string }> = {
  rouge: { label: 'Problème', ton: 'critical', pastille: '🔴' },
  orange: { label: 'À surveiller', ton: 'caution', pastille: '🟠' },
  vert: { label: 'Bonne nouvelle', ton: 'positive', pastille: '🟢' },
}

export function AlertesNova({
  alertes,
  locale,
  siteId,
  transmission,
}: {
  alertes: readonly Alerte[]
  locale: string
  siteId: string
  transmission?: TransmissionNova
}) {
  if (alertes.length === 0) return null
  const suffixe = siteId === '' ? '' : `&siteId=${siteId}`
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Alertes Nova</h2>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {alertes.map((alerte) => {
            const niveau = NIVEAU[alerte.niveau]
            const qui = membre(alerte.agent)
            return (
              <li key={alerte.cle} className="border-t border-[var(--color-line)] pt-3 first:border-t-0 first:pt-0">
                <p className="m-0 text-sm font-medium">
                  <span aria-hidden="true">{niveau.pastille} </span>
                  {alerte.texte}
                </p>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">{alerte.fondement}</p>
                {qui === undefined || alerte.niveau === 'vert' ? null : transmission === undefined ? (
                  <a
                    href={`/${locale}/visibilite/equipe?agent=${alerte.agent}${suffixe}`}
                    className="mt-1 inline-block text-xs font-medium"
                  >
                    En parler avec {qui.name}
                  </a>
                ) : (
                  <Transmettre cle={alerte.cle} agent={alerte.agent} pour="regarder ce qui a changé" transmission={transmission} />
                )}
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

const TON_INSIGHT: Record<Insight['ton'], string> = {
  positif: 'var(--color-positive)',
  neutre: 'var(--color-ink-soft)',
  attention: 'var(--color-caution)',
}

/** Ce que Nova a détecté : le bloc le plus visible après les chiffres. */
export function InsightsNova({ insights }: { insights: readonly Insight[] }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] p-5">
      <div className="flex items-center gap-3">
        <Portrait taille={32} />
        <h2 className="m-0 text-base font-semibold">Ce que Nova a détecté</h2>
      </div>
      {insights.length === 0 ? (
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Rien qui dépasse les seuils sur cette période. Je ne signale une évolution que lorsqu’elle repose sur assez de
          ventes ou de conversions pour être plus qu’un hasard.
        </p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {insights.map((insight) => (
            <li key={insight.cle} className="flex gap-3">
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TON_INSIGHT[insight.ton] }} />
              <div className="min-w-0">
                <p className="m-0 text-sm leading-relaxed font-medium">{insight.texte}</p>
                <p className="mt-0.5 mb-0 text-xs text-[var(--color-ink-soft)]">{insight.fondement}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Canaux ───────────────────────────────────────────────────────────────────

function Chiffre({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[11px] text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 text-sm font-medium tabular-nums">{valeur}</dd>
    </div>
  )
}

export function CanauxNova({ canaux, devise }: { canaux: readonly LigneCanal[]; devise: string }) {
  const meilleur = [...canaux]
    .filter((canal) => canal.chiffre !== null && canal.chiffre > 0 && canal.canal !== 'inconnu')
    .sort((un, autre) => (autre.chiffre ?? 0) - (un.chiffre ?? 0))[0]
  return (
    <section>
      <h2 className="m-0 text-lg font-semibold">Performance des canaux</h2>
      <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
        {meilleur === undefined
          ? 'Ce que déclarent les régies, et ce que la boutique a vu arriver au dernier clic.'
          : `Top canal côté boutique : ${meilleur.nom}. Les régies déclarent leurs propres chiffres, affichés à part.`}
      </p>
      {canaux.length === 0 ? (
        <Card>
          <CardBody>
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">Aucun canal mesuré sur cette période.</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {canaux.map((canal) => (
            <li key={canal.canal} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <p className="m-0 text-sm font-semibold">{canal.nom}</p>
              <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                {canal.depenses === null ? null : <Chiffre label="Dépenses" valeur={argent(canal.depenses, devise)} />}
                {canal.conversionsDeclarees === null ? null : <Chiffre label="Conv. déclarées" valeur={nombre(canal.conversionsDeclarees, 1)} />}
                {canal.revenuDeclare === null ? null : <Chiffre label="Revenu déclaré" valeur={argent(canal.revenuDeclare, devise)} />}
                {canal.roas === null && canal.depenses === null ? null : <Chiffre label="ROAS" valeur={canal.roas === null ? '—' : `${canal.roas} %`} />}
                {canal.depenses === null ? null : <Chiffre label="CPA" valeur={argent(canal.cpa, devise)} />}
                {canal.tauxConversion === null ? null : <Chiffre label="Taux de conv." valeur={`${nombre(canal.tauxConversion, 1)} %`} />}
                {canal.trafic === null ? null : <Chiffre label={canal.depenses === null ? 'Clics Google' : 'Clics'} valeur={nombre(canal.trafic)} />}
                {canal.sessions === null ? null : <Chiffre label="Visites (GA4)" valeur={nombre(canal.sessions)} />}
                {canal.conversionGa4 === null ? null : <Chiffre label="Conversion (GA4)" valeur={`${nombre(canal.conversionGa4, 1)} %`} />}
                {canal.commandes === null ? null : <Chiffre label="Commandes boutique" valeur={nombre(canal.commandes)} />}
                {canal.chiffre === null ? null : <Chiffre label="CA boutique" valeur={argent(canal.chiffre, devise)} />}
              </dl>
              {canal.traficNote === '' || canal.trafic === null ? null : (
                <p className="mt-2 mb-0 text-[11px] text-[var(--color-ink-faint)]">Trafic : {canal.traficNote}.</p>
              )}
              {canal.origines.length === 0 ? null : (
                <p className="mt-1 mb-0 text-[11px] break-words text-[var(--color-ink-faint)]">Regroupe : {canal.origines.join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Attribution ──────────────────────────────────────────────────────────────

export function AttributionNova({
  attribution,
  devise,
  manqueVentes,
}: {
  attribution: Attribution
  devise: string
  manqueVentes: string
}) {
  if (attribution.plateformes.length === 0 && attribution.reel === null) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Attribution</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
            <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-soft)] uppercase">Données plateformes</p>
            {attribution.plateformes.length === 0 ? (
              <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">Aucune régie reliée.</p>
            ) : (
              <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-sm">
                {attribution.plateformes.map((ligne) => (
                  <li key={ligne.plateforme}>
                    <strong>{ligne.nom.replace(' Ads', '')}</strong> : {nombre(ligne.conversions, 1)} conversions ·{' '}
                    {argent(ligne.revenu, devise)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
            <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-soft)] uppercase">Données réelles</p>
            {attribution.reel === null ? (
              <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">{manqueVentes}</p>
            ) : (
              <p className="mt-2 mb-0 text-sm">
                <strong>Shopify</strong> : {nombre(attribution.reel.commandes)} commandes · {argent(attribution.reel.chiffre, devise)}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 mb-0 text-sm leading-relaxed">{attribution.explication}</p>
        <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">
          <strong>Modèle utilisé</strong> — {attribution.modele}
        </p>
      </CardBody>
    </Card>
  )
}

// ── Opportunités ─────────────────────────────────────────────────────────────

const IMPACT: Record<Opportunite['impact'], string> = { faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé' }

export function OpportunitesNova({
  opportunites,
  transmission,
}: {
  opportunites: readonly Opportunite[]
  transmission?: TransmissionNova
}) {
  if (opportunites.length === 0) return null
  return (
    <section>
      <h2 className="m-0 mb-3 text-lg font-semibold">Opportunités Nova</h2>
      <ul className="m-0 grid list-none gap-3 p-0">
        {opportunites.map((opportunite) => {
          const qui = membre(opportunite.agent)
          return (
            <li key={opportunite.cle} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <p className="m-0 text-sm font-semibold">{opportunite.titre}</p>
              <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                <strong className="text-[var(--color-ink)]">Pourquoi :</strong> {opportunite.pourquoi}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={opportunite.impact === 'eleve' ? 'brand' : 'neutral'}>Impact : {IMPACT[opportunite.impact]}</Badge>
                <Badge tone="neutral">Agent : {qui?.name ?? opportunite.agent}</Badge>
                <a href={opportunite.cta.href} className="ml-auto text-sm font-medium">
                  {opportunite.cta.label} →
                </a>
              </div>
              <Transmettre cle={opportunite.cle} agent={opportunite.agent} pour="en tirer parti" transmission={transmission} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Campagnes et produits ────────────────────────────────────────────────────

export function CampagnesNova({
  campagnes,
  devise,
  filtre,
  lien,
}: {
  campagnes: readonly LigneCampagne[]
  devise: string
  filtre: 'toutes' | 'google' | 'meta'
  lien: (filtre: string) => string
}) {
  const visibles = campagnes.filter(
    (ligne) => filtre === 'toutes' || (filtre === 'google' ? ligne.plateforme === 'google-ads' : ligne.plateforme === 'meta-ads'),
  )
  if (campagnes.length === 0) return null
  return (
    <section id="campagnes" className="scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold">Campagnes</h2>
        <nav className="flex gap-2" aria-label="Régie">
          {(['toutes', 'google', 'meta'] as const).map((cle) => (
            <a
              key={cle}
              href={lien(cle)}
              aria-current={cle === filtre ? 'page' : undefined}
              className={`rounded-[var(--radius-pill)] border px-3 py-1 text-xs no-underline ${
                cle === filtre ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]' : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
              }`}
            >
              {cle === 'toutes' ? 'Toutes' : cle === 'google' ? 'Google' : 'Meta'}
            </a>
          ))}
        </nav>
      </div>
      <p className="mt-0 mb-3 text-xs text-[var(--color-ink-soft)]">
        Chiffres déclarés par Naya (Google Ads) et MIRA (Meta Ads). Évolution : ROAS comparé à la période précédente.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0">
        {visibles.map((ligne) => (
          <li key={`${ligne.plateforme}:${ligne.campagneId}`} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold break-words">{ligne.nom}</span>
              <Badge tone="neutral">{ligne.plateforme === 'google-ads' ? 'Google' : 'Meta'}</Badge>
            </div>
            <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
              <Chiffre label="Dépenses" valeur={argent(ligne.depenses, devise)} />
              <Chiffre label="Conversions" valeur={nombre(ligne.conversions, 1)} />
              <Chiffre label="CA déclaré" valeur={argent(ligne.revenu, devise)} />
              <Chiffre label="CPA" valeur={argent(ligne.cpa, devise)} />
              <Chiffre label="ROAS" valeur={ligne.roas === null ? '—' : `${ligne.roas} %`} />
              <div className="flex flex-col-reverse">
                <dt className="text-[11px] text-[var(--color-ink-soft)]">Évolution</dt>
                <dd className="m-0">
                  <Variation valeur={ligne.evolution} mieux="hausse" />
                </dd>
              </div>
            </dl>
          </li>
        ))}
        {visibles.length === 0 ? (
          <li className="text-sm text-[var(--color-ink-soft)]">Aucune campagne sur cette régie pour la période.</li>
        ) : null}
      </ul>
    </section>
  )
}

export function ProduitsNova({ produits, devise }: { produits: readonly LigneProduit[]; devise: string }) {
  if (produits.length === 0) return null
  const avecMarge = produits.some((produit) => produit.marge !== null)
  return (
    <section>
      <h2 className="m-0 text-lg font-semibold">Produits</h2>
      <p className="mt-1 mb-3 text-xs text-[var(--color-ink-soft)]">
        {avecMarge
          ? 'Selon vos commandes Shopify. Marge brute = ventes − coût d’achat saisi dans Shopify (coût actuel), hors livraison, frais et publicité. Estimation basée sur les coûts renseignés.'
          : 'Selon vos commandes Shopify. Renseignez « Coût par article » dans vos fiches produits Shopify, puis actualisez : Nova affichera la marge de chaque produit.'}
      </p>
      <ul className="m-0 grid list-none gap-3 p-0">
        {produits.map((produit) => (
          <li key={produit.id} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold break-words">{produit.titre}</span>
              <span className="text-sm font-semibold tabular-nums">{argent(produit.chiffre, devise)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-canvas)]">
              <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${Math.max(2, Math.round(produit.part * 100))}%` }} />
            </div>
            <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
              <Chiffre label="Part du CA" valeur={`${Math.round(produit.part * 100)} %`} />
              <Chiffre label="Commandes" valeur={nombre(produit.commandes)} />
              <Chiffre label="Quantité" valeur={nombre(produit.quantite)} />
              <Chiffre label="Panier moyen" valeur={argent(produit.panier, devise)} />
              <div className="flex flex-col-reverse">
                <dt className="text-[11px] text-[var(--color-ink-soft)]">Évolution</dt>
                <dd className="m-0">
                  <Variation valeur={produit.evolution} mieux="hausse" />
                </dd>
              </div>
              {avecMarge ? (
                <Chiffre
                  label="Marge brute"
                  valeur={
                    produit.marge === null || produit.tauxMarge === null
                      ? 'coût incomplet'
                      : `${argent(produit.marge, devise)} · ${Math.round(produit.tauxMarge * 100)} %`
                  }
                />
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Santé des données, Oria, conversation ───────────────────────────────────

const ETAT: Record<LigneSante['etat'], { label: string; ton: 'positive' | 'caution' | 'critical' | 'neutral' }> = {
  bon: { label: '🟢 Bon', ton: 'positive' },
  verifier: { label: '🟠 À vérifier', ton: 'caution' },
  probleme: { label: '🔴 Problème', ton: 'critical' },
  absent: { label: 'Non relié', ton: 'neutral' },
  bientot: { label: 'Bientôt', ton: 'neutral' },
}

/** Ce que chaque destinataire fait d'un point de suivi : Léa audite, les régies corrigent leurs liens. */
const POUR_SUIVI: Record<string, string> = {
  audit: 'auditer le suivi',
  ads: 'vérifier le marquage',
  meta: 'vérifier les liens',
}

export function SanteNova({
  global,
  lignes,
  transmission,
}: {
  global: 'bon' | 'verifier' | 'probleme'
  lignes: readonly LigneSante[]
  transmission?: TransmissionNova
}) {
  const etat = ETAT[global]
  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-base font-semibold">Santé des données</h2>
          <Badge tone={etat.ton}>{etat.label}</Badge>
        </div>
        <ul className="m-0 mt-3 grid list-none gap-0 p-0">
          {lignes.map((ligne) => {
            const vu = ETAT[ligne.etat]
            return (
              <li key={ligne.cle} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-line)] py-2.5 first:border-t-0">
                <span className="w-36 shrink-0 text-sm font-medium">{ligne.source}</span>
                <Badge tone={vu.ton}>{vu.label}</Badge>
                <span className="min-w-0 flex-1 basis-56 text-xs text-[var(--color-ink-soft)]">{ligne.texte}</span>
                {ligne.action === null ? null : (
                  <a href={ligne.action.href} className="text-xs font-medium">
                    {ligne.action.label}
                  </a>
                )}
                {ligne.agent === undefined || (ligne.etat !== 'verifier' && ligne.etat !== 'probleme') ? null : (
                  <div className="basis-full">
                    <Transmettre cle={ligne.cle} agent={ligne.agent} pour={POUR_SUIVI[ligne.agent] ?? 'regarder'} transmission={transmission} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

export function PourOriaNova({ rapport, versOria }: { rapport: RapportOria; versOria: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Nova → Oria</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
          Ce que Nova transmet à Oria pour classer vos priorités. Oria cite ces chiffres, elle ne les recalcule pas.
        </p>
        <p className="mt-3 mb-0 text-xs text-[var(--color-ink-soft)]">
          Période : {rapport.periode} · Sources : {rapport.sources.length === 0 ? 'aucune' : rapport.sources.join(' + ')}
        </p>
        {rapport.observations.length === 0 ? (
          <p className="mt-2 mb-0 text-sm">Aucune observation à transmettre sur cette période.</p>
        ) : (
          <ol className="mt-2 mb-0 grid gap-1 pl-5 text-sm">
            {rapport.observations.map((observation) => (
              <li key={observation}>{observation}</li>
            ))}
          </ol>
        )}
        {rapport.recommandation === null ? null : (
          <p className="mt-3 mb-0 text-sm">
            <strong>Recommandation :</strong> {rapport.recommandation}
          </p>
        )}
        <a href={versOria} className="mt-3 inline-block text-sm font-medium">
          Voir les priorités d’Oria →
        </a>
      </CardBody>
    </Card>
  )
}

const QUESTIONS = [
  'Quel canal me rapporte le plus ?',
  'Meta ou Google fonctionne mieux ?',
  'Quel est mon vrai ROAS ?',
  'Où est-ce que je perds de l’argent ?',
  'Qu’est-ce qui a changé cette semaine ?',
  'Quels sont mes 3 chiffres les plus importants aujourd’hui ?',
]

export function ParlerANova({ versConversation, cout }: { versConversation: string | null; cout: number }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-3">
          <Portrait taille={40} />
          <h2 className="m-0 text-base font-semibold">Parler à Nova</h2>
        </div>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Posez une question sur vos chiffres : Nova répond avec les données réelles de vos sources, en disant lesquelles
          et sur quelle période. Tout ce qui est affiché sur cet écran est gratuit ; une question coûte {cout} crédits.
        </p>
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
          {QUESTIONS.map((question) => (
            <li key={question} className="rounded-[var(--radius-pill)] border border-[var(--color-line)] px-3 py-1 text-xs text-[var(--color-ink-soft)]">
              {question}
            </li>
          ))}
        </ul>
        <div className="mt-4">
          {versConversation === null ? (
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">
              La conversation s’ouvre une fois votre site analysé par Léa : c’est là que votre équipe échange.
            </p>
          ) : (
            <LinkButton href={versConversation}>Ouvrir la conversation</LinkButton>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

// ── V2 : onglets ─────────────────────────────────────────────────────────────

/** Ce qu'il faut pour transmettre un point à un spécialiste. Absent : pas de bouton (site non analysé). */
export type TransmissionNova = {
  siteId: string
  locale: string
  cout: number
  versConversation: string
  /** La période affichée : le serveur relit le point sur la même. */
  periode: { periode: string; du: string; au: string }
}

function Transmettre({ cle, agent, pour, transmission }: { cle: string; agent: string; pour: string; transmission?: TransmissionNova }) {
  if (transmission === undefined) return null
  return (
    <DelegationOria
      cle={cle}
      siteId={transmission.siteId}
      locale={transmission.locale}
      destinataires={[{ agent, pour }]}
      cout={{ min: transmission.cout, max: transmission.cout }}
      versConversation={transmission.versConversation}
      route="/api/nova/deleguer"
      expediteur="Nova"
      contexte={transmission.periode}
    />
  )
}

export type OngletNova = 'tableau' | 'bilan' | 'pilotage' | 'clients'

export function OngletsNova({ courant, locale, siteId }: { courant: OngletNova; locale: string; siteId: string }) {
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  const onglets: { cle: OngletNova; label: string; href: string }[] = [
    { cle: 'tableau', label: 'Tableau de bord', href: `/${locale}/nova${suffixe}` },
    { cle: 'bilan', label: 'Bilan de la semaine', href: `/${locale}/nova/bilan${suffixe}` },
    { cle: 'pilotage', label: 'Objectifs et marge', href: `/${locale}/nova/pilotage${suffixe}` },
    { cle: 'clients', label: 'Clients et parcours', href: `/${locale}/nova/clients${suffixe}` },
  ]
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Nova">
      {onglets.map((onglet) => (
        <a
          key={onglet.cle}
          href={onglet.href}
          aria-current={onglet.cle === courant ? 'page' : undefined}
          className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
            onglet.cle === courant
              ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
              : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
          }`}
        >
          {onglet.label}
        </a>
      ))}
    </nav>
  )
}

export function AVenirNova({ texte }: { texte: string | null }) {
  if (texte === null) return null
  return <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">{texte}</p>
}

// ── V2 : objectifs et marge ──────────────────────────────────────────────────

const TENDANCE: Record<SuiviObjectif['tendance'], { label: string; ton: 'positive' | 'caution' | 'critical' | 'neutral' }> = {
  atteint: { label: 'Atteint', ton: 'positive' },
  'en-avance': { label: 'En bonne voie', ton: 'positive' },
  'en-retard': { label: 'En retard', ton: 'caution' },
  'hors-cible': { label: 'Hors objectif', ton: 'critical' },
  inconnue: { label: 'À mesurer', ton: 'neutral' },
}

function valeurSuivi(valeur: number | null, format: SuiviObjectif['format'], devise: string): string {
  if (valeur === null) return '—'
  if (format === 'argent') return argent(valeur, devise)
  if (format === 'pourcent') return `${nombre(valeur)} %`
  return nombre(valeur)
}

export function ObjectifsNova({
  suivis,
  devise,
  versReglages,
}: {
  suivis: readonly SuiviObjectif[]
  devise: string
  versReglages: string | null
}) {
  return (
    <section>
      <h2 className="m-0 text-lg font-semibold">Mes objectifs</h2>
      {suivis.length === 0 ? (
        <p className="mt-1 mb-0 text-sm text-[var(--color-ink-soft)]">
          Aucun objectif fixé. {versReglages === null ? null : <a href={versReglages}>Fixer mes objectifs</a>}
        </p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2">
          {suivis.map((suivi) => {
            const tendance = TENDANCE[suivi.tendance]
            return (
              <li key={suivi.cle} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{suivi.label}</span>
                  <Badge tone={tendance.ton}>{tendance.label}</Badge>
                </div>
                <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                  <Chiffre label="Objectif" valeur={valeurSuivi(suivi.objectif, suivi.format, devise)} />
                  <Chiffre label="Actuel" valeur={valeurSuivi(suivi.actuel, suivi.format, devise)} />
                  <Chiffre
                    label={suivi.projection === null ? 'Écart' : 'Fin de mois'}
                    valeur={
                      suivi.projection === null
                        ? suivi.ecart === null
                          ? '—'
                          : `${suivi.ecart > 0 ? '+' : '−'}${nombre(Math.abs(suivi.ecart), 1)} %`
                        : `≈ ${valeurSuivi(suivi.projection, suivi.format, devise)}`
                    }
                  />
                </dl>
                <p className="mt-2 mb-0 text-[11px] text-[var(--color-ink-faint)]">{suivi.commentaire}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function MargeNova({ marge, devise, mention }: { marge: Marge; devise: string; mention: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Marge estimée</h2>
        {marge.etat === 'impossible' ? (
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">{marge.raison}</p>
        ) : (
          <>
            <ul className="m-0 mt-3 grid list-none gap-1 p-0 text-sm">
              <li className="flex justify-between gap-3">
                <span>Chiffre d’affaires</span>
                <span className="tabular-nums">{argent(marge.chiffre, devise)}</span>
              </li>
              {marge.lignes.map((ligne) => (
                <li key={ligne.quoi} className="flex justify-between gap-3 text-[var(--color-ink-soft)]">
                  <span>− {ligne.quoi}</span>
                  <span className="tabular-nums">{argent(ligne.montant, devise)}</span>
                </li>
              ))}
              <li className="mt-1 flex justify-between gap-3 border-t border-[var(--color-line)] pt-2 font-semibold">
                <span>= Marge estimée</span>
                <span className="tabular-nums" style={{ color: marge.marge < 0 ? 'var(--color-critical)' : undefined }}>
                  {argent(marge.marge, devise)} ({nombre(marge.taux * 100, 1)} %)
                </span>
              </li>
            </ul>
            {marge.manquants.length === 0 ? null : (
              <p className="mt-2 mb-0 text-xs text-[var(--color-caution)]">
                Non renseignés : {marge.manquants.join(', ')}. La marge réelle est probablement plus basse.
              </p>
            )}
            {marge.note === null ? null : <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">{marge.note}</p>}
            {marge.merEquilibre === null ? null : (
              <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3 text-sm">
                <p className="m-0 font-medium">Seuil de rentabilité publicitaire : MER {nombre(marge.merEquilibre)} %</p>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                  Chaque {devise} de publicité doit amener au moins {nombre(marge.merEquilibre / 100, 2)} {devise} de ventes pour ne pas coûter plus
                  qu’il ne laisse, avec les coûts ci-dessus. En dessous, la publicité fait perdre de l’argent — sauf si ces clients reviennent acheter.
                </p>
              </div>
            )}
            <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">{mention}</p>
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ── V2 : bilan ───────────────────────────────────────────────────────────────

export function BilanNova({ bilan }: { bilan: Bilan }) {
  const { vue } = bilan
  const lignes: [string, string | null][] = [
    ['Top canal', bilan.topCanal],
    ['Top campagne', bilan.topCampagne],
    ['Top produit', bilan.topProduit],
    ['Anomalie principale', bilan.anomalie],
    ['Opportunité principale', bilan.opportunite],
  ]
  return (
    <div className="grid gap-6">
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">
        {vue.periode.libelle} · comparé à la semaine précédente · Sources : {vue.sources.length === 0 ? 'aucune' : vue.sources.join(' + ')}
      </p>
      <IndicateursNova kpis={bilan.chiffres} devise={vue.devise} ordre={bilan.chiffres.map((kpi) => kpi.cle)} />
      <Card>
        <CardBody>
          <h2 className="m-0 text-base font-semibold">L’essentiel</h2>
          <dl className="m-0 mt-3 grid gap-2">
            {lignes.map(([quoi, valeur]) => (
              <div key={quoi} className="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
                <dt className="text-xs text-[var(--color-ink-soft)]">{quoi}</dt>
                <dd className="m-0 text-sm">{valeur ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['Ce qui progresse', bilan.progresse.map((ligne) => ligne.texte), 'var(--color-positive)'],
            ['Ce qui baisse', bilan.baisse.map((ligne) => ligne.texte), 'var(--color-critical)'],
            ['Ce qui mérite votre attention', bilan.attention, 'var(--color-caution)'],
          ] as const
        ).map(([titre, elements, couleur]) => (
          <section key={titre} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h3 className="m-0 text-sm font-semibold" style={{ color: couleur }}>
              {titre}
            </h3>
            {elements.length === 0 ? (
              <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">Rien de notable.</p>
            ) : (
              <ul className="mt-2 mb-0 grid gap-1 pl-4 text-sm">
                {elements.map((element) => (
                  <li key={element}>{element}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

// ── V2 : clients et parcours ─────────────────────────────────────────────────

export function ClientsNova({
  repartition,
  valeur,
  devise,
  mention,
}: {
  repartition: RepartitionClients | null
  valeur: ValeurClient
  devise: string
  mention: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <CardBody>
          <h2 className="m-0 text-base font-semibold">Nouveaux et fidèles</h2>
          {repartition === null ? (
            <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">Aucune vente lue sur la période.</p>
          ) : (
            <>
              <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                <Chiffre label="Nouveaux clients" valeur={nombre(repartition.nouveaux.commandes)} />
                <Chiffre label="Clients revenus" valeur={nombre(repartition.existants.commandes)} />
                <Chiffre label="Non identifiés" valeur={nombre(repartition.inconnus.commandes)} />
                <Chiffre label="CA nouveaux" valeur={argent(repartition.nouveaux.chiffre, devise)} />
                <Chiffre label="CA autres" valeur={argent(repartition.autresChiffre, devise)} />
                <Chiffre
                  label="Part de nouveaux"
                  valeur={repartition.partNouveaux === null ? '—' : `${Math.round(repartition.partNouveaux * 100)} %`}
                />
              </dl>
              <p className="mt-2 mb-0 text-[11px] text-[var(--color-ink-faint)]">
                En commandes. « Non identifiés » : commandes sans client connu, dont on ne sait pas s’ils étaient nouveaux.
              </p>
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="m-0 text-base font-semibold">Valeur d’un client</h2>
          {valeur.etat === 'insuffisant' ? (
            <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">{valeur.raison}</p>
          ) : (
            <>
              <dl className="m-0 mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                <Chiffre label="Valeur moyenne" valeur={argent(valeur.valeur, devise)} />
                <Chiffre label="Commandes par client" valeur={nombre(valeur.commandesParClient, 2)} />
                <Chiffre label="Clients" valeur={nombre(valeur.clients)} />
                <Chiffre label="Revenus au moins une fois" valeur={`${Math.round(valeur.tauxRetour * 100)} %`} />
              </dl>
              <p className="mt-2 mb-0 text-[11px] text-[var(--color-ink-faint)]">{mention}</p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

const NOMS_MODELES: Record<Modele, string> = { dernier: 'Dernier clic', premier: 'Premier clic', partage: 'Partagé' }

export function ModelesNova({
  lignes,
  devise,
  explications,
}: {
  lignes: readonly LigneModele[] | null
  devise: string
  explications: Record<Modele, { nom: string; explication: string }>
}) {
  return (
    <section>
      <h2 className="m-0 text-lg font-semibold">Chiffre d’affaires selon le modèle d’attribution</h2>
      <ul className="mt-1 mb-3 grid gap-0.5 pl-4 text-xs text-[var(--color-ink-soft)]">
        {(Object.keys(explications) as Modele[]).map((cle) => (
          <li key={cle}>
            <strong>{explications[cle].nom}</strong> — {explications[cle].explication}
          </li>
        ))}
        <li>
          Linéaire, en position et « data-driven » demandent chaque visite intermédiaire d’un acheteur : ni Shopify ni les
          rapports agrégés de GA4 ne la donnent.
        </li>
      </ul>
      {lignes === null ? (
        <Card>
          <CardBody>
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">
              Les premières visites ne sont pas encore connues : elles arrivent à la prochaine lecture complète des ventes.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {lignes.map((ligne) => (
            <li key={ligne.canal} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <p className="m-0 text-sm font-semibold">{ligne.nom}</p>
              <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                {(['dernier', 'premier', 'partage'] as const).map((modele) => (
                  <Chiffre key={modele} label={NOMS_MODELES[modele]} valeur={argent(ligne.chiffre[modele], devise)} />
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ParcoursNova({ phrases, mention }: { phrases: readonly string[]; mention: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Parcours de conversion</h2>
        {phrases.length === 0 ? (
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
            Aucun rôle net ne se dégage encore : il faut assez de commandes dont la première et la dernière visite sont connues.
          </p>
        ) : (
          <ul className="mt-2 mb-0 grid gap-1 pl-4 text-sm">
            {phrases.map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
          <strong>Interprétation</strong> — {mention}
        </p>
      </CardBody>
    </Card>
  )
}

// ── V3 : visites ─────────────────────────────────────────────────────────────

const NOM_APPAREIL: Record<string, string> = { mobile: 'Mobile', desktop: 'Ordinateur', tablet: 'Tablette' }

/**
 * Appareils et pages d'entrée, selon GA4.
 *
 * Deux questions que seules les visites peuvent trancher : où la conversion décroche (le
 * mobile, souvent), et quelles pages font entrer les acheteurs.
 */
export function VisitesNova({ visites, devise }: { visites: CumulVisites; devise: string }) {
  const appareils = Object.entries(visites.appareils)
    .filter(([, ligne]) => ligne.sessions > 0)
    .sort((un, autre) => autre[1].sessions - un[1].sessions)
  const pages = visites.pages.slice(0, 5)
  const pagesSeo = visites.pagesSeo.filter((page) => page.revenu > 0).slice(0, 5)
  const listePages = (titre: string, lignes: typeof pages, vide: string) => (
    <div>
      <h3 className="m-0 text-sm font-semibold">{titre}</h3>
      {lignes.length === 0 ? (
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">{vide}</p>
      ) : (
        <ul className="m-0 mt-2 grid list-none gap-2 p-0">
          {lignes.map((page) => (
            <li key={page.page} className="grid gap-0.5">
              <span className="text-sm break-all">{page.page}</span>
              <span className="text-xs text-[var(--color-ink-soft)]">
                {nombre(page.sessions)} visites · {nombre(page.achats)} achat{page.achats > 1 ? 's' : ''} · {argent(page.revenu, devise)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Appareils et pages</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">Selon Google Analytics 4, sur la période.</p>
        <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
          {appareils.map(([appareil, ligne]) => (
            <Chiffre
              key={appareil}
              label={`${NOM_APPAREIL[appareil] ?? appareil} — ${nombre(ligne.sessions)} visites`}
              valeur={`${nombre((ligne.achats / ligne.sessions) * 100, 1)} % achètent`}
            />
          ))}
        </dl>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {listePages('Pages d’entrée les plus visitées', pages, 'Aucune page relevée.')}
          {listePages('Pages qui vendent depuis Google', pagesSeo, 'Aucun achat venu de la recherche naturelle sur la période.')}
        </div>
      </CardBody>
    </Card>
  )
}

// ── V4 : contenus ────────────────────────────────────────────────────────────

/**
 * Les articles par lesquels on entre sur le site, et ce qu'ils retiennent. L'engagement se lit
 * contre la moyenne du site : un article à 70 % sur un site à 65 % n'a rien d'exceptionnel.
 */
export function ContenusNova({ contenus, devise, transmission }: { contenus: Contenus; devise: string; transmission?: TransmissionNova }) {
  if (contenus.lignes.length === 0) return null
  const site = contenus.engagementSite
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Contenus qui attirent</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
          Articles de blog par lesquels les visiteurs arrivent, selon GA4.
          {site === null ? '' : ` Engagement moyen du site : ${Math.round(site * 100)} %.`} Un article se lit souvent avant d’acheter, pas en achetant : ses ventes directes ne disent pas tout.
        </p>
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {contenus.lignes.map((ligne) => {
            const auDessus = site !== null && ligne.engagement !== null && ligne.engagement - site >= 0.1
            return (
              <li key={ligne.page} className="border-t border-[var(--color-line)] pt-2 first:border-t-0 first:pt-0">
                <p className="m-0 text-sm break-all">{ligne.page}</p>
                <p className="mt-0.5 mb-0 text-xs text-[var(--color-ink-soft)]">
                  {nombre(ligne.sessions)} visites ·{' '}
                  {ligne.engagement === null ? 'engagement pas encore mesuré' : `${Math.round(ligne.engagement * 100)} % engagées`}
                  {auDessus ? ' · au-dessus du site' : ''}
                  {ligne.achats > 0 ? ` · ${nombre(ligne.achats)} achat${ligne.achats > 1 ? 's' : ''} · ${argent(ligne.revenu, devise)}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
        {transmission === undefined ? null : (
          <Transmettre
            cle={`contenus`}
            agent="content"
            pour="écrire dans la même veine"
            transmission={transmission}
          />
        )}
      </CardBody>
    </Card>
  )
}
