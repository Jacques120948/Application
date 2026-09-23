import { membre } from '@/lib/equipe'
import { Badge, Card, CardBody, LinkButton } from '@/components/ui'
import type { EtatLina, PaniersLina as Paniers } from '@/server/lina/collecte'
import type { Campagne, InsightLina, LigneSanteCrm, Niveau } from '@/server/lina/recommandations'
import type { Indicateurs, LigneRfm, Segment } from '@/server/lina/segments'
import type { DepuisNova, MembreVu } from '@/server/lina/service'
import { lienFiche, NOM_SOURCE_LINA, numeroClient, type SourceLina } from '@/lib/lina'
import { CopierTexte } from './CopierTexte'
import { CreerSegmentLina } from './AssisteLina'
import { DelegationOria } from './DelegationOria'

/**
 * Les blocs de l'écran de Lina.
 *
 * Rendus par le serveur, sans état. Chaque bloc répond à l'une des questions qu'on se pose
 * en l'ouvrant : qui relancer, qui sont mes meilleurs clients, qui ne revient plus, combien
 * rachètent, quelle campagne lancer maintenant.
 *
 * **Aucun nom n'apparaît ici**, parce qu'aucun n'a été lu. Un client est un identifiant, un
 * nombre de commandes et un montant ; son nom est à un clic, dans la boutique.
 */

function nombre(valeur: number, decimales = 0): string {
  return new Intl.NumberFormat('fr-CH', { maximumFractionDigits: decimales }).format(valeur)
}

function argent(cents: number | null, devise: string): string {
  if (cents === null) return '—'
  const valeur = cents / 100
  return `${devise} ${nombre(valeur, Math.abs(valeur) < 100 ? 2 : 0)}`.trim()
}

function pourcent(part: number | null): string {
  return part === null ? '—' : `${nombre(part * 100, part < 0.1 ? 1 : 0)} %`
}

function Portrait({ taille }: { taille: number }) {
  const lina = membre('lina')
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={lina?.avatar ?? '/equipe/lina.webp'}
      alt=""
      width={taille}
      height={taille}
      className="shrink-0 rounded-full object-cover"
      style={{ width: taille, height: taille }}
    />
  )
}

function Chiffre({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[11px] text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 text-sm font-medium tabular-nums">{valeur}</dd>
    </div>
  )
}

// ── En-tête, onglets, accueil ────────────────────────────────────────────────

export function EnteteLina({ versAnalyse, versSegments, versConversation }: { versAnalyse: string; versSegments: string; versConversation: string }) {
  return (
    <section
      className="on-night rounded-[var(--radius-card)] border border-[var(--color-night-line)] p-5 text-white sm:p-6"
      style={{ background: 'var(--gradient-night)' }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Portrait taille={72} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold tracking-[0.2em] text-white/70 uppercase">Lina</p>
          <h1 className="m-0 mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">CRM & Fidélisation</h1>
        </div>
      </div>
      <p className="mt-4 mb-0 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
        Je transforme vos clients existants en clients plus fidèles et plus rentables : qui relancer, pourquoi, quand et
        avec quel message.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <LinkButton href={versAnalyse}>Analyser mes clients</LinkButton>
        <a
          href={versSegments}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/30 px-4 py-2 text-sm font-medium text-white no-underline hover:border-white/60"
        >
          Voir mes segments
        </a>
        <a
          href={versConversation}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/30 px-4 py-2 text-sm font-medium text-white no-underline hover:border-white/60"
        >
          Parler à Lina
        </a>
      </div>
    </section>
  )
}

export type OngletLina = 'tableau' | 'bilan' | 'segments' | 'produits' | 'valeur' | 'resultats'

export function OngletsLina({ courant, locale, siteId }: { courant: OngletLina; locale: string; siteId: string }) {
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  const onglets: { cle: OngletLina; label: string; href: string }[] = [
    { cle: 'tableau', label: 'Tableau de bord', href: `/${locale}/lina${suffixe}` },
    { cle: 'bilan', label: 'Bilan et objectifs', href: `/${locale}/lina/bilan${suffixe}` },
    { cle: 'segments', label: 'Segments clients', href: `/${locale}/lina/segments${suffixe}` },
    { cle: 'produits', label: 'Produits et réachat', href: `/${locale}/lina/produits${suffixe}` },
    { cle: 'valeur', label: 'Valeur client', href: `/${locale}/lina/valeur${suffixe}` },
    { cle: 'resultats', label: 'Résultats', href: `/${locale}/lina/resultats${suffixe}` },
  ]
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Lina">
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

/**
 * La première ouverture, et tout ce qui empêche de lire : Lina dit ce qui manque et propose
 * une seule chose.
 */
export function AccueilLina({
  etat,
  activite,
  versConnexions,
  children,
}: {
  etat: EtatLina
  activite: string
  versConnexions: string
  children?: React.ReactNode
}) {
  const bloquant =
    etat.etat === 'absent'
      ? 'Pour commencer, reliez votre boutique Shopify ou WooCommerce, ou votre compte Stripe : c’est là que vivent vos clients.'
      : etat.etat === 'offre'
        ? 'La lecture de votre boutique n’est pas incluse dans votre offre actuelle.'
        : etat.etat === 'portee' || etat.etat === 'protegees' || etat.etat === 'erreur'
          ? etat.message
          : null
  return (
    <Card>
      <CardBody>
        <p className="m-0 text-base leading-relaxed">
          Bonjour, je suis <strong>Lina</strong> 👋
        </p>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Je m’occupe de vos clients après leur première visite ou leur premier achat. Mon objectif est de vous aider à
          les faire revenir, acheter à nouveau et rester fidèles.
        </p>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Commençons par analyser votre base clients. Je lis, pour chaque client, ses dates d’achat, son nombre de commandes,
          ce qu’il a dépensé et, quand la boutique le dit, s’il accepte vos emails — jamais son nom ni son adresse, et aucun
          courriel n’est conservé : ils restent dans votre boutique.
        </p>
        {activite === 'services' || activite === 'saas' ? (
          <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Vous avez déclaré une activité {activite === 'services' ? 'de services' : 'd’abonnement logiciel'}. Je lis vos
            clients dans Shopify, WooCommerce ou Stripe ; vos prospects (HubSpot) et vos abonnements sont suivis par Nova, et je
            m’appuie sur ses chiffres pour vous proposer des relances.
          </p>
        ) : null}
        {bloquant === null ? null : <p className="mt-4 mb-0 text-sm leading-relaxed text-[var(--color-critical)]">{bloquant}</p>}
        <div className="mt-4">
          {etat.etat === 'absent' ? <LinkButton href={versConnexions}>Relier ma boutique</LinkButton> : children}
        </div>
      </CardBody>
    </Card>
  )
}

// ── Tableau de bord ──────────────────────────────────────────────────────────

export function IndicateursLina({
  indicateurs,
  paniers,
  devise,
  topSegment,
  opportunites,
}: {
  indicateurs: Indicateurs
  paniers: Paniers | null
  devise: string
  topSegment: Segment | null
  opportunites: number
}) {
  const cartes: { cle: string; label: string; valeur: string; note: string }[] = [
    { cle: 'actifs', label: 'Clients actifs', valeur: nombre(indicateurs.actifs), note: `sur ${nombre(indicateurs.acheteurs)} acheteurs` },
    { cle: 'nouveaux', label: 'Nouveaux clients', valeur: nombre(indicateurs.nouveaux), note: 'premier achat récent' },
    { cle: 'recurrents', label: 'Clients récurrents', valeur: nombre(indicateurs.recurrents), note: 'au moins deux commandes' },
    { cle: 'reachat', label: 'Taux de réachat', valeur: pourcent(indicateurs.tauxReachat), note: 'acheteurs qui ont recommandé' },
    { cle: 'panier', label: 'Panier moyen', valeur: argent(indicateurs.panierMoyenCents, devise), note: 'toutes commandes confondues' },
    {
      cle: 'reactiver',
      label: 'Clients à réactiver',
      valeur: nombre(indicateurs.aReactiver + indicateurs.dormants),
      note: `${nombre(indicateurs.aReactiver)} inactifs, ${nombre(indicateurs.dormants)} dormants`,
    },
    {
      cle: 'paniers',
      label: 'Paniers abandonnés',
      valeur: paniers === null || paniers.erreur !== undefined ? '—' : nombre(paniers.courant.nombre),
      note: paniers === null || paniers.erreur !== undefined ? 'non lus' : `${paniers.jours} derniers jours · ${argent(paniers.courant.valeurCents, devise)}`,
    },
    {
      cle: 'ca',
      label: 'CA des clients récurrents',
      valeur: argent(indicateurs.caRecurrentsCents, devise),
      note: `${pourcent(indicateurs.partCaRecurrents)} du CA de vos clients`,
    },
    { cle: 'top', label: 'Segment prioritaire', valeur: topSegment?.nom ?? '—', note: topSegment === null ? '' : `${nombre(topSegment.nombre)} clients` },
    { cle: 'opportunites', label: 'Opportunités', valeur: nombre(opportunites), note: 'campagnes recommandées' },
  ]
  return (
    <section id="chiffres" className="scroll-mt-6">
      <h2 className="sr-only">Vos clients</h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {cartes.map((carte) => (
          <li key={carte.cle} className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <span className="text-xs text-[var(--color-ink-soft)]">{carte.label}</span>
            <span className={`font-semibold tracking-tight break-words tabular-nums ${carte.valeur.length > 12 ? 'text-base sm:text-lg' : 'text-xl sm:text-2xl'}`}>{carte.valeur}</span>
            {carte.note === '' ? null : <span className="text-[11px] leading-snug text-[var(--color-ink-faint)]">{carte.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function InsightsLina({ insights }: { insights: readonly InsightLina[] }) {
  if (insights.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Ce que Lina a détecté</h2>
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {insights.map((insight) => (
            <li key={insight.cle} className="border-l-2 border-[var(--color-brand)] pl-3 text-sm leading-relaxed">
              {insight.texte}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

/** Ce qu'il faut pour transmettre à un spécialiste. Absent : site non analysé, pas de bouton. */
export type TransmissionLina = { siteId: string; locale: string; cout: number; versConversation: string }

function Transmettre({ cle, agent, pour, transmission }: { cle: string; agent: 'content' | 'cro'; pour: string; transmission?: TransmissionLina }) {
  if (transmission === undefined) return null
  return (
    <DelegationOria
      cle={cle}
      siteId={transmission.siteId}
      locale={transmission.locale}
      destinataires={[{ agent, pour }]}
      cout={{ min: transmission.cout, max: transmission.cout }}
      versConversation={transmission.versConversation}
      route="/api/lina/deleguer"
      expediteur="Lina"
    />
  )
}

export function ReactivationLina({
  segments,
  devise,
  campagnes,
  produits,
}: {
  segments: readonly Segment[]
  devise: string
  campagnes: readonly Campagne[]
  produits: Partial<Record<string, string>>
}) {
  const tranches = segments.filter((segment) => (segment.cle === 'a-reactiver' || segment.cle === 'dormants') && segment.nombre > 0)
  if (tranches.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Clients à réactiver</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {tranches.map((segment) => {
            const campagne = campagnes.find((un) => un.segment === segment.cle)
            return (
              <div key={segment.cle} className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-3">
                <p className="m-0 text-sm leading-relaxed">
                  <strong>{nombre(segment.nombre)} clients</strong> {segment.critere.charAt(0).toLowerCase() + segment.critere.slice(1)}.
                </p>
                <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  <Chiffre label="CA historique" valeur={argent(segment.caCents, devise)} />
                  <Chiffre label="Panier moyen" valeur={argent(segment.panierMoyenCents, devise)} />
                  <Chiffre label="Dernier achat (médiane)" valeur={segment.joursMedian === null ? '—' : `il y a ${nombre(segment.joursMedian)} j`} />
                  <Chiffre label="Joignables par email" valeur={segment.contactables === null ? 'à vérifier' : nombre(segment.contactables)} />
                  {campagne === undefined ? null : <Chiffre label="Potentiel (hypothèse)" valeur={argent(campagne.potentielCents, devise)} />}
                  {produits[segment.cle] === undefined ? null : <Chiffre label="Produit principal" valeur={produits[segment.cle]!} />}
                </dl>
                {campagne === undefined ? null : (
                  <a href={`#campagne-${campagne.cle}`} className="mt-3 inline-block text-xs font-medium">
                    Créer une campagne →
                  </a>
                )}
              </div>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
}

export function PaniersLina({ paniers, devise, transmission }: { paniers: Paniers | null; devise: string; transmission?: TransmissionLina }) {
  if (paniers === null) return null
  if (paniers.erreur !== undefined) {
    return (
      <Card>
        <CardBody>
          <h2 className="m-0 text-base font-semibold">Paniers abandonnés</h2>
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">{paniers.erreur}</p>
        </CardBody>
      </Card>
    )
  }
  const { courant } = paniers
  const taux = courant.nombre === 0 ? null : courant.recuperes / courant.nombre
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Paniers abandonnés</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">{paniers.jours} derniers jours, selon Shopify (paniers où l’acheteur a laissé son adresse).</p>
        <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Chiffre label="Nombre" valeur={nombre(courant.nombre)} />
          <Chiffre label="Valeur totale" valeur={argent(courant.valeurCents, devise)} />
          <Chiffre label="Valeur moyenne" valeur={courant.nombre === 0 ? '—' : argent(Math.round(courant.valeurCents / courant.nombre), devise)} />
          <Chiffre label="Finalement payés" valeur={pourcent(taux)} />
        </dl>
        <p className="mt-3 mb-0 text-xs text-[var(--color-ink-soft)]">
          Période précédente : {nombre(paniers.precedent.nombre)} paniers ({argent(paniers.precedent.valeurCents, devise)}).
        </p>
        {courant.nombre > 0 ? (
          <>
            <a href="#campagne-panier-abandonne" className="mt-3 inline-block text-xs font-medium">
              Voir la séquence de relance proposée →
            </a>
            <Transmettre cle="paniers" agent="cro" pour="analyser le tunnel d’achat" transmission={transmission} />
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}

const TON_NIVEAU: Record<Niveau, 'positive' | 'caution' | 'neutral'> = { eleve: 'positive', moyen: 'caution', faible: 'neutral' }
const MOT_NIVEAU: Record<Niveau, string> = { eleve: 'élevé', moyen: 'moyen', faible: 'faible' }

export function CampagnesLina({
  campagnes,
  devise,
  transmission,
  assiste = false,
}: {
  campagnes: readonly Campagne[]
  devise: string
  transmission?: TransmissionLina
  /** V4 : mode assisté — créer l'audience dans Shopify sur validation. */
  assiste?: boolean
}) {
  if (campagnes.length === 0) return null
  return (
    <section id="campagnes" className="grid scroll-mt-6 gap-3">
      <h2 className="m-0 text-base font-semibold">Campagnes recommandées</h2>
      <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
        Classées par potentiel et par effort. Lina prépare ; rien n’est envoyé sans vous. Le potentiel est une hypothèse de calcul
        pour comparer les campagnes, pas une prévision.
      </p>
      {campagnes.map((campagne, rang) => (
        <Card key={campagne.cle}>
          <CardBody>
            <div id={`campagne-${campagne.cle}`} className="scroll-mt-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--color-ink-faint)] tabular-nums">{rang + 1}.</span>
                <h3 className="m-0 text-sm font-semibold">{campagne.titre}</h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={TON_NIVEAU[campagne.impact]}>Impact {MOT_NIVEAU[campagne.impact]}</Badge>
                <Badge>Effort {MOT_NIVEAU[campagne.effort]}</Badge>
                <Badge tone="brand">
                  {nombre(campagne.audience)} {campagne.audienceLibelle}
                </Badge>
              </div>
              <dl className="m-0 mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="text-[11px] text-[var(--color-ink-soft)]">Objectif</dt>
                  <dd className="m-0">{campagne.objectif}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink-soft)]">Message</dt>
                  <dd className="m-0">{campagne.message}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink-soft)]">Timing · canal</dt>
                  <dd className="m-0">
                    {campagne.timing} · {campagne.canal}
                  </dd>
                </div>
              </dl>
              {campagne.etapes.length > 0 ? (
                <ol className="m-0 mt-3 grid list-none gap-1 p-0 text-xs">
                  {campagne.etapes.map((etape) => (
                    <li key={etape.quand} className="flex gap-2">
                      <span className="w-24 shrink-0 font-medium tabular-nums">{etape.quand}</span>
                      <span className="text-[var(--color-ink-soft)]">{etape.contenu}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">{campagne.remise}</p>
              <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">{campagne.consentement}</p>
              <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
                Potentiel {argent(campagne.potentielCents, devise)}. {campagne.hypothese}
              </p>
              {campagne.requeteShopify === null ? null : (
                <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-2">
                  <p className="m-0 text-[11px] text-[var(--color-ink-soft)]">
                    Pour retrouver cette audience dans Shopify (Clients → Segments → Créer un segment) :
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="text-[11px] break-all">{campagne.requeteShopify}</code>
                    <CopierTexte texte={campagne.requeteShopify} />
                  </div>
                  {assiste ? (
                    <div className="mt-2">
                      <CreerSegmentLina type="campagne" cle={campagne.cle} nom={campagne.titre} />
                    </div>
                  ) : null}
                </div>
              )}
              <Transmettre cle={campagne.cle} agent="content" pour="rédiger les emails" transmission={transmission} />
            </div>
          </CardBody>
        </Card>
      ))}
    </section>
  )
}

export function QuickWinsLina({ quickWins }: { quickWins: readonly { cle: string; texte: string }[] }) {
  if (quickWins.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Quick wins</h2>
        <ol className="m-0 mt-3 grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
          {quickWins.map((gain) => (
            <li key={gain.cle}>
              <a href={`#campagne-${gain.cle}`} className="text-[var(--color-ink)]">
                {gain.texte}
              </a>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}

/** Ce que Nova sait, et ce que cela dit de la fidélisation — sans rien recalculer. */
export function NovaLina({ nova, indicateurs, devise }: { nova: DepuisNova | null; indicateurs: Indicateurs; devise: string }) {
  if (nova === null || nova.cac === null || indicateurs.panierMoyenCents === null) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Selon Nova</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed">
          Sur les 30 derniers jours, un nouveau client vous a coûté{' '}
          <strong>
            {nova.devise} {nombre(nova.cac, 2)}
          </strong>{' '}
          en publicité. Un client qui revient ne coûte que le message qui le fait revenir, et son panier moyen est de{' '}
          <strong>{argent(indicateurs.panierMoyenCents, devise)}</strong>.
        </p>
        <p className="mt-2 mb-0 text-[11px] text-[var(--color-ink-faint)]">Coût d’acquisition calculé par Nova ; panier moyen calculé par Lina sur toute l’histoire des clients.</p>
      </CardBody>
    </Card>
  )
}

const TON_SANTE: Record<LigneSanteCrm['etat'], { label: string; ton: 'positive' | 'caution' | 'critical' }> = {
  bon: { label: 'Bon', ton: 'positive' },
  verifier: { label: 'À vérifier', ton: 'caution' },
  probleme: { label: 'Problème', ton: 'critical' },
}

export function SanteLina({ lignes }: { lignes: readonly LigneSanteCrm[] }) {
  if (lignes.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Santé de la base clients</h2>
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {lignes.map((ligne) => (
            <li key={ligne.cle} className="flex flex-wrap items-start gap-2 text-sm leading-relaxed">
              <Badge tone={TON_SANTE[ligne.etat].ton}>{TON_SANTE[ligne.etat].label}</Badge>
              <span className="min-w-0 flex-1">{ligne.texte}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

export function PourOriaLina({ lignes, versOria }: { lignes: readonly string[]; versOria: string }) {
  if (lignes.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Transmis à Oria</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">Oria décide si ces opportunités passent avant le reste de votre plan.</p>
        <ul className="m-0 mt-3 grid list-disc gap-1 pl-5 text-sm leading-relaxed">
          {lignes.map((ligne) => (
            <li key={ligne}>{ligne}</li>
          ))}
        </ul>
        <a href={versOria} className="mt-3 inline-block text-xs font-medium">
          Voir les priorités d’Oria →
        </a>
      </CardBody>
    </Card>
  )
}

const QUESTIONS = [
  'Quels clients dois-je relancer ?',
  'Combien de clients reviennent acheter ?',
  'Quels sont mes meilleurs clients ?',
  'Qui risque de ne plus revenir ?',
  'Quelle campagne dois-je lancer cette semaine ?',
  'Combien valent mes clients fidèles ?',
]

export function ParlerALina({ versConversation, cout }: { versConversation: string | null; cout: number }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Parler à Lina</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
          Une question coûte environ {cout} crédits. Lina ne reçoit que des segments et des totaux, jamais une fiche client.
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

// ── Segments ─────────────────────────────────────────────────────────────────

export function SegmentsLina({
  segments,
  devise,
  selection,
  lien,
}: {
  segments: readonly Segment[]
  devise: string
  selection: string | null
  lien: (cle: string) => string
}) {
  return (
    <section className="grid gap-3">
      <h2 className="m-0 text-base font-semibold">Segments clients</h2>
      <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
        Un client peut appartenir à plusieurs segments : un VIP est souvent aussi fidèle et actif. Les segments ne s’additionnent donc pas.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {segments.map((segment) => (
          <li
            key={segment.cle}
            className={`min-w-0 rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-4 ${
              selection === segment.cle ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)]'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold">{segment.nom}</h3>
              <span className="text-lg font-semibold tabular-nums">{nombre(segment.nombre)}</span>
            </div>
            <p className="mt-1 mb-0 text-[11px] leading-snug text-[var(--color-ink-soft)]">{segment.critere}</p>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <Chiffre label="CA cumulé" valeur={argent(segment.caCents, devise)} />
              <Chiffre label="Part du CA" valeur={pourcent(segment.partCa)} />
              <Chiffre label="Panier moyen" valeur={argent(segment.panierMoyenCents, devise)} />
              <Chiffre label="Joignables par email" valeur={segment.contactables === null ? 'à vérifier' : nombre(segment.contactables)} />
              {segment.contactablesSms == null ? null : <Chiffre label="Joignables par SMS" valeur={nombre(segment.contactablesSms)} />}
            </dl>
            {segment.tropPetit ? <p className="mt-2 mb-0 text-[11px] text-[var(--color-caution)]">Segment trop petit pour en tirer une règle.</p> : null}
            {segment.nombre > 0 ? (
              <a href={lien(segment.cle)} className="mt-3 inline-block text-xs font-medium">
                Voir les clients →
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RfmLina({ lignes, devise }: { lignes: readonly LigneRfm[] | null; devise: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Récence, fréquence, montant (RFM)</h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          Un indicateur interne : chaque acheteur est noté de 1 à 5 sur la date de sa dernière commande et sur ce qu’il a dépensé,
          comparés à vos autres clients, et sur son nombre de commandes.
        </p>
        {lignes === null ? (
          <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">Il faut au moins 50 acheteurs pour que ces classes aient un sens.</p>
        ) : (
          <ul className="m-0 mt-3 grid list-none gap-2 p-0">
            {lignes.map((ligne) => (
              <li key={ligne.cle} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line)] pb-2 text-sm">
                <span>{ligne.nom}</span>
                <span className="tabular-nums text-[var(--color-ink-soft)]">
                  {nombre(ligne.nombre)} clients · {argent(ligne.caCents, devise)} · {pourcent(ligne.partCa)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

const MOT_CONSENTEMENT: Record<string, string> = { oui: 'accepte les emails', non: 'n’accepte pas les emails', 'sans-email': 'sans email', inconnu: 'consentement inconnu' }

/**
 * Les clients d'un segment. Un numéro, des chiffres, et un lien vers la fiche dans Shopify :
 * c'est là, et seulement là, que la personne voit un nom.
 */
export function MembresLina({
  segment,
  membres,
  devise,
  boutique,
  source,
  versFiche,
  assiste = false,
}: {
  segment: Segment
  membres: readonly MembreVu[]
  devise: string
  boutique: string
  source: SourceLina | null
  /** V4 : la fiche du client dans Evoliia, sans nom. */
  versFiche?: (ref: string) => string
  /** V4 : mode assisté — Lina peut créer le segment dans Shopify sur validation. */
  assiste?: boolean
}) {
  const outil = source === null ? 'votre boutique' : NOM_SOURCE_LINA[source]
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">
          {segment.nom} — {nombre(segment.nombre)} clients
        </h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          Les {nombre(membres.length)} qui ont le plus dépensé. Lina ne connaît pas leur nom : ouvrez leur fiche dans {outil} pour le voir.
        </p>
        {segment.requeteShopify === null ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="text-[11px] break-all">{segment.requeteShopify}</code>
            <CopierTexte texte={segment.requeteShopify} libelle="Copier la requête Shopify" />
          </div>
        )}
        {segment.requeteShopify === null || !assiste ? null : (
          <div className="mt-2">
            <CreerSegmentLina type="segment" cle={segment.cle} nom={segment.nom} />
          </div>
        )}
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {membres.map((client) => {
            const fiche = lienFiche(source, boutique, client.ref)
            return (
            <li key={client.ref} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] pb-2 text-xs">
              <span className="min-w-0">
                {versFiche === undefined ? (
                  <span className="font-medium">{numeroClient(source, client.ref)}</span>
                ) : (
                  <a href={versFiche(client.ref)} className="font-medium underline">
                    {numeroClient(source, client.ref)}
                  </a>
                )}
                <span className="text-[var(--color-ink-soft)]">
                  {' '}
                  · {nombre(client.commandes)} commande{client.commandes > 1 ? 's' : ''} · {argent(client.caCents, devise)}
                  {client.derniereCommande === null ? '' : ` · dernière le ${client.derniereCommande.split('-').reverse().join('.')}`} ·{' '}
                  {MOT_CONSENTEMENT[client.consentement] ?? client.consentement}
                  {client.consentementSms === 'oui' ? ' · accepte les SMS' : ''}
                </span>
              </span>
              {fiche === null ? null : (
                <a href={fiche.href} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium">
                  {fiche.libelle}
                </a>
              )}
            </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}
