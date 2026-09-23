import { ecranDuMembre, membre, type IdMembre } from '@/lib/equipe'
import { Badge, Card, CardBody, LinkButton } from '@/components/ui'
import type { Signal } from '@/server/oria/signaux'
import type { Canal } from '@/server/oria/sante'
import type { EtatAgent } from '@/server/oria/cockpit'
import type { Evenement } from '@/server/oria/activite'
import type { ActionPlan, JourSemaine, PlanMarketing } from '@/server/oria/plan-marketing'
import type { RapportSemaine, Resultat } from '@/server/oria/rapport'
import type { Decision, Impact } from '@/server/oria/decisions'
import type { Destinataire } from '@/server/oria/delegation'
import { DelegationOria } from './DelegationOria'

/**
 * Les blocs du cockpit d'Oria.
 *
 * Tous sont rendus par le serveur et n'ont pas d'état : le cockpit se lit, il ne se
 * manipule pas. Ce qui se manipule — cocher une correction, valider un budget — vit chez
 * le spécialiste, et chaque bloc y renvoie. Oria oriente, elle ne retient pas.
 *
 * La règle qui a décidé de la forme de chacun est celle du cahier des charges : moins de
 * données, plus de décisions. Aucun bloc n'affiche un chiffre qui ne serve pas à décider,
 * et aucun n'affiche un chiffre qu'on ne sait pas d'où il vient — le « Pourquoi ? » de
 * chaque priorité le dit.
 */

// ── Vocabulaire commun ───────────────────────────────────────────────────────

const AMPLEUR: Record<string, string> = { faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé' }

const URGENCE: Record<string, { label: string; ton: 'critical' | 'caution' | 'positive' }> = {
  critique: { label: 'Critique', ton: 'critical' },
  important: { label: 'Important', ton: 'caution' },
  information: { label: 'Information', ton: 'positive' },
}

const CONFIANCE: Record<string, string> = {
  elevee: 'Confiance élevée',
  moyenne: 'Confiance moyenne',
  faible: 'Confiance faible',
}

/** La solidité des données, seule, pour la case « Données » d'une priorité. */
const SOLIDITE: Record<string, string> = { elevee: 'Solides', moyenne: 'Partielles', faible: 'Minces' }

/** Les prénoms derrière un signal, écrits comme on les dit : « Cleo et Naya ». */
function nommer(sources: readonly string[]): string {
  const noms = sources.map((source) => membre(source)?.name ?? source)
  if (noms.length <= 1) return noms[0] ?? ''
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
}

/**
 * Il y a combien de temps, dit comme on le dit.
 *
 * Calculé au rendu, sur le serveur : l'heure qu'il est au moment où la page part. Une page
 * laissée ouverte une journée affichera « il y a 2 heures » pour ce qui en a vingt-six ;
 * c'est le prix d'un écran sans script, et il se règle d'un rafraîchissement.
 */
function depuis(date: Date | null, maintenant: Date): string {
  if (date === null) return 'jamais'
  const minutes = Math.max(0, Math.round((+maintenant - +date) / 60_000))
  if (minutes < 2) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} minutes`
  const heures = Math.round(minutes / 60)
  if (heures < 24) return `il y a ${heures} heure${heures > 1 ? 's' : ''}`
  const jours = Math.round(heures / 24)
  if (jours < 30) return `il y a ${jours} jour${jours > 1 ? 's' : ''}`
  return `le ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long' }).format(date)}`
}

/** Un portrait rond, ou la pastille à initiale quand il manque. */
function Portrait({ id, taille }: { id: string; taille: number }) {
  const qui = membre(id)
  if (qui?.avatar === undefined) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-canvas)] text-xs font-semibold"
        style={{ width: taille, height: taille }}
      >
        {(qui?.name ?? id).slice(0, 1)}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={qui.avatar}
      alt=""
      width={taille}
      height={taille}
      className="shrink-0 rounded-full object-cover"
      style={{ width: taille, height: taille }}
    />
  )
}

// ── En-tête ──────────────────────────────────────────────────────────────────

/**
 * L'en-tête, et la seule surface « premium » de l'écran.
 *
 * Le fond de nuit est celui de la page d'accueil, là où le produit se montre sous son
 * meilleur jour : Oria est l'entrée du studio, et c'est le seul endroit où cette
 * différence se voit. Le reste du cockpit garde les cartes de tous les écrans — un
 * tableau de bord qui change de style à chaque bloc se lit plus mal, pas mieux.
 */
export function EnteteOria({ versPriorites, versConversation }: { versPriorites: string; versConversation: string }) {
  return (
    <section
      className="on-night rounded-[var(--radius-card)] border border-[var(--color-night-line)] p-5 text-white sm:p-6"
      style={{ background: 'var(--gradient-night)' }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Portrait id="oria" taille={72} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold tracking-[0.2em] text-white/70 uppercase">Oria</p>
          <h1 className="m-0 mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">
            Votre directrice marketing
          </h1>
        </div>
      </div>
      <p className="mt-4 mb-0 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
        Je rassemble les analyses de votre équipe et je vous aide à concentrer votre temps et
        votre budget sur ce qui compte le plus.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <LinkButton href={versPriorites}>Voir mes priorités</LinkButton>
        <a
          href={versConversation}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/30 px-4 py-2 text-sm font-medium text-white no-underline hover:border-white/60"
        >
          Parler à Oria
        </a>
      </div>
    </section>
  )
}

/**
 * La première ouverture, quand il n'y a encore rien à lire.
 *
 * Oria ne fait pas semblant : sans site analysé ni compte relié, elle n'a aucun constat à
 * classer. Elle le dit, et elle dit par où commencer — une seule action, pas un
 * questionnaire.
 */
export function AccueilOria({ versAnalyse }: { versAnalyse: string }) {
  return (
    <Card>
      <CardBody>
        <p className="m-0 text-base leading-relaxed">
          Bonjour, je suis <strong>Oria</strong>. Je coordonne votre équipe marketing.
        </p>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Mon rôle est de rassembler ce que vos spécialistes trouvent, pour vous dire quoi faire,
          dans quel ordre, et pourquoi. Pour l’instant, ils n’ont encore rien analysé : je n’ai
          rien à classer. Commençons par votre site — Léa le lit, et les autres travaillent à
          partir de là.
        </p>
        <div className="mt-5">
          <LinkButton href={versAnalyse}>Analyser mon marketing</LinkButton>
        </div>
      </CardBody>
    </Card>
  )
}

// ── Aujourd'hui ──────────────────────────────────────────────────────────────

/**
 * Ce qu'Oria voit aujourd'hui, en une ou deux phrases et trois compteurs.
 *
 * La phrase est assemblée par du code à partir de l'état des canaux ; les compteurs sont
 * comptés. Rien ici ne vient d'un modèle, et c'est pour cela que le bloc peut s'afficher à
 * chaque ouverture sans coûter un crédit.
 */
export function Aujourdhui({
  phrase,
  critiques,
  ouverts,
  inconnus,
}: {
  phrase: string
  critiques: number
  ouverts: number
  inconnus: number
}) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Aujourd’hui</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed">{phrase}</p>
        <dl className="m-0 mt-4 grid grid-cols-3 gap-3">
          {[
            { valeur: critiques, quoi: critiques > 1 ? 'critiques' : 'critique', ton: critiques > 0 ? 'var(--color-critical)' : undefined },
            { valeur: ouverts, quoi: ouverts > 1 ? 'points ouverts' : 'point ouvert', ton: undefined },
            { valeur: inconnus, quoi: inconnus > 1 ? 'canaux non vus' : 'canal non vu', ton: undefined },
          ].map((compteur) => (
            <div
              key={compteur.quoi}
              className="flex flex-col-reverse rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-3 py-2"
            >
              <dt className="text-xs text-[var(--color-ink-soft)]">{compteur.quoi}</dt>
              <dd className="m-0 text-xl font-semibold" style={{ color: compteur.ton }}>
                {compteur.valeur}
              </dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  )
}

// ── Priorités ────────────────────────────────────────────────────────────────

/**
 * Une priorité, avec ce qu'il faut pour décider et rien de plus.
 *
 * Le « Pourquoi ? » est replié et il est toujours là. Il dit d'où vient le constat, qui l'a
 * relevé, sur combien de données, et comment Oria l'a classé : les quatre critères du
 * calcul. Une priorité sans justification se lit comme un ordre ; avec, elle se discute,
 * et c'est ce qu'on veut.
 */
export function CartePriorite({
  signal,
  rang,
  delegation,
}: {
  signal: Signal
  rang: number
  /**
   * À qui Oria peut transmettre ce point. Absent : pas de délégation possible — pas de
   * site analysé, ou l'offre ne l'ouvre pas.
   */
  delegation?: {
    destinataires: readonly Destinataire[]
    siteId: string
    locale: string
    cout: number
    versConversation: string
  }
}) {
  const urgence = URGENCE[signal.urgence]
  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-sm font-semibold text-[var(--color-surface)]">
            {rang}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base leading-snug font-semibold">{signal.titre}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
                <span className="flex -space-x-2">
                  {signal.sources.map((source) => (
                    <Portrait key={source} id={source} taille={22} />
                  ))}
                </span>
                {nommer(signal.sources)}
              </span>
              {urgence === undefined ? null : <Badge tone={urgence.ton}>{urgence.label}</Badge>}
            </div>
          </div>
        </div>

        {signal.pourquoi === '' ? null : (
          <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {signal.pourquoi}
          </p>
        )}

        <dl className="m-0 mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-2 py-1.5">
            <dt className="text-[11px] text-[var(--color-ink-faint)]">Impact</dt>
            <dd className="m-0 text-sm font-medium">{AMPLEUR[signal.impact]}</dd>
          </div>
          <div className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-2 py-1.5">
            <dt className="text-[11px] text-[var(--color-ink-faint)]">Effort</dt>
            <dd className="m-0 text-sm font-medium">{AMPLEUR[signal.effort]}</dd>
          </div>
          <div className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-2 py-1.5">
            <dt className="text-[11px] text-[var(--color-ink-faint)]">Données</dt>
            <dd className="m-0 text-sm font-medium">{SOLIDITE[signal.confiance]}</dd>
          </div>
        </dl>

        {signal.quoiFaire === '' ? null : (
          <p className="mt-4 mb-0 text-sm leading-relaxed">
            <span className="font-medium">À faire : </span>
            {signal.quoiFaire}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <LinkButton href={signal.href} variant="secondary">
            Voir l’analyse
          </LinkButton>
        </div>

        {delegation === undefined ? null : (
          <DelegationOria
            cle={signal.cle}
            siteId={delegation.siteId}
            locale={delegation.locale}
            destinataires={delegation.destinataires}
            cout={{ min: delegation.cout, max: delegation.cout }}
            versConversation={delegation.versConversation}
          />
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-[var(--color-ink-soft)]">Pourquoi ?</summary>
          <div className="mt-2 grid gap-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            <p className="m-0">
              <span className="font-medium text-[var(--color-ink)]">Données : </span>
              {signal.mesure}
            </p>
            <p className="m-0">
              <span className="font-medium text-[var(--color-ink)]">Relevé par : </span>
              {nommer(signal.sources)}.
            </p>
            <p className="m-0">
              <span className="font-medium text-[var(--color-ink)]">Classement : </span>
              impact {AMPLEUR[signal.impact]?.toLowerCase()}, effort{' '}
              {AMPLEUR[signal.effort]?.toLowerCase()}, urgence {urgence?.label.toLowerCase()},{' '}
              {CONFIANCE[signal.confiance]?.toLowerCase()}. Oria ne mesure rien elle-même : elle
              ordonne ce que ses collègues ont relevé.
            </p>
          </div>
        </details>
      </CardBody>
    </Card>
  )
}

/**
 * Ce qui attend derrière les trois priorités.
 *
 * Replié, et c'est tout l'objet : les voir d'emblée remettrait la personne devant la
 * liste de vingt-sept lignes dont Oria est censée la délivrer. Ouvert, chaque ligne dit
 * qui l'a relevée et où aller.
 */
export function AutresRecommandations({ signaux }: { signaux: readonly Signal[] }) {
  if (signaux.length === 0) return null
  return (
    <details className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <summary className="cursor-pointer text-sm font-medium">
        Voir les {signaux.length} autre{signaux.length > 1 ? 's' : ''} recommandation
        {signaux.length > 1 ? 's' : ''}
      </summary>
      <ul className="m-0 mt-4 grid list-none gap-3 p-0">
        {signaux.map((signal) => (
          <li key={signal.cle} className="flex items-start gap-3">
            <Portrait id={signal.sources[0] ?? ''} taille={24} />
            <div className="min-w-0 flex-1">
              <a href={signal.href} className="text-sm font-medium text-[var(--color-ink)] no-underline hover:underline">
                {signal.titre}
              </a>
              <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                {nommer(signal.sources)} · {URGENCE[signal.urgence]?.label} · effort{' '}
                {AMPLEUR[signal.effort]?.toLowerCase()}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}

// ── Alertes ──────────────────────────────────────────────────────────────────

/**
 * Les alertes critiques qui ne sont pas déjà en tête.
 *
 * Une alerte qui répète la priorité affichée juste au-dessus est du bruit. Ce bloc ne
 * montre donc que ce qui est critique **et** n'a pas trouvé sa place parmi les trois — le
 * cas où plusieurs choses brûlent en même temps. La plupart du temps, il ne s'affiche pas,
 * et c'est ce qu'on attend d'une alerte.
 */
export function AlertesOria({ alertes }: { alertes: readonly Signal[] }) {
  if (alertes.length === 0) return null
  return (
    <section
      className="rounded-[var(--radius-card)] border p-5"
      style={{ borderColor: 'var(--color-critical)', background: 'var(--color-critical-soft)' }}
    >
      <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--color-critical)' }}>
        {alertes.length === 1 ? 'Une autre alerte critique' : `${alertes.length} autres alertes critiques`}
      </h2>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {alertes.map((alerte) => (
          <li key={alerte.cle}>
            <a href={alerte.href} className="text-sm font-medium text-[var(--color-ink)] no-underline hover:underline">
              {alerte.titre}
            </a>
            <span className="text-xs text-[var(--color-ink-soft)]"> — {nommer(alerte.sources)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Santé marketing ──────────────────────────────────────────────────────────

const ETAT_CANAL: Record<string, { label: string; ton: 'positive' | 'caution' | 'critical' | 'neutral' }> = {
  bon: { label: 'Bon', ton: 'positive' },
  surveiller: { label: 'À surveiller', ton: 'caution' },
  renforcer: { label: 'À renforcer', ton: 'critical' },
  inconnu: { label: 'Pas de donnée', ton: 'neutral' },
}

/**
 * La santé de chaque canal, et ce qu'il faut relier pour voir les autres.
 *
 * Un canal sans donnée porte « Pas de donnée », jamais un état : c'est la différence entre
 * informer et rassurer. Et il porte un lien vers ce qui le rendrait visible, parce que
 * « je ne sais pas » sans « voici comment savoir » n'aide personne.
 */
export function SanteMarketing({ canaux, versConnexions }: { canaux: readonly Canal[]; versConnexions: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Santé marketing</h2>
        <ul className="m-0 mt-3 grid list-none gap-0 p-0">
          {canaux.map((canal) => {
            const etat = ETAT_CANAL[canal.etat]
            return (
              <li
                key={canal.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-line)] py-2.5 first:border-t-0"
              >
                <span className="w-32 shrink-0 text-sm font-medium">{canal.nom}</span>
                {etat === undefined ? null : <Badge tone={etat.ton}>{etat.label}</Badge>}
                <span className="min-w-0 flex-1 basis-48 text-xs text-[var(--color-ink-soft)]">
                  {canal.pourquoi}
                </span>
                {canal.aRelier === '' ? null : (
                  <a href={versConnexions} className="text-xs font-medium">
                    Connecter {canal.aRelier}
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

// ── Équipe ───────────────────────────────────────────────────────────────────

const STATUT: Record<string, { label: string; ton: 'positive' | 'caution' | 'critical' | 'neutral' }> = {
  actif: { label: 'Actif', ton: 'positive' },
  action: { label: 'Action requise', ton: 'critical' },
  connexion: { label: 'Connexion nécessaire', ton: 'neutral' },
  'a-lancer': { label: 'Analyse à lancer', ton: 'caution' },
}

/**
 * L'équipe, sous Oria.
 *
 * Chacun avec son statut, sa dernière lecture réelle et ce qu'il a d'ouvert. La carte
 * mène à son écran : c'est là qu'on approfondit, et c'est ce qu'Oria doit toujours
 * permettre — elle synthétise, puis elle passe la main.
 */
export function EquipeOria({
  equipe,
  locale,
  siteId,
  maintenant,
}: {
  equipe: readonly EtatAgent[]
  locale: string
  siteId: string
  maintenant: Date
}) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Mon équipe</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
          Oria lit ce que chacun a trouvé. Pour approfondir, allez voir le spécialiste.
        </p>
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {equipe.map((agent) => {
            const qui = membre(agent.id)
            const statut = STATUT[agent.statut]
            return (
              <li key={agent.id}>
                <a
                  href={ecranDuMembre(agent.id as IdMembre, locale, siteId).href}
                  className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] p-3 text-[var(--color-ink)] no-underline hover:border-[var(--color-brand)]"
                >
                  <Portrait id={agent.id} taille={40} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-medium">
                      {qui?.name}{' '}
                      <span className="font-normal text-[var(--color-ink-faint)]">· {qui?.role}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {statut === undefined ? null : <Badge tone={statut.ton}>{statut.label}</Badge>}
                      {agent.ouverts === 0 ? null : (
                        <span className="text-xs text-[var(--color-ink-soft)]">
                          {agent.ouverts} ouvert{agent.ouverts > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {agent.statut === 'connexion' || agent.statut === 'a-lancer' ? null : (
                      <p className="m-0 mt-1 text-[11px] text-[var(--color-ink-faint)]">
                        Dernière lecture : {depuis(agent.derniere, maintenant)}
                      </p>
                    )}
                  </div>
                </a>
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

// ── Activité ─────────────────────────────────────────────────────────────────

/**
 * Ce que l'équipe a fait, avec l'heure réelle.
 *
 * Uniquement des événements enregistrés. « Oria a transmis à Cleo » n'apparaît que
 * lorsque la délégation a réellement eu lieu, réponse comprise.
 */
export function ActiviteEquipe({ activite, maintenant }: { activite: readonly Evenement[]; maintenant: Date }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Activité de mon équipe</h2>
        {activite.length === 0 ? (
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
            Rien encore : l’activité apparaîtra ici dès la première analyse.
          </p>
        ) : (
          <ol className="m-0 mt-3 grid list-none gap-3 p-0">
            {activite.map((evenement, rang) => (
              <li key={`${+evenement.quand}-${rang}`} className="flex items-start gap-3">
                <Portrait id={evenement.qui} taille={24} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm leading-snug">{evenement.quoi}</p>
                  <p className="m-0 text-[11px] text-[var(--color-ink-faint)]">
                    {depuis(evenement.quand, maintenant)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/** Qui décide, qui prépare. Aujourd'hui c'est toujours « vous, avec » un spécialiste. */
function quiFait(uneAction: ActionPlan): string {
  const aide = nommer(uneAction.aide)
  const qui =
    uneAction.responsable.type === 'collaborateur' ? uneAction.responsable.nom : 'Vous'
  return aide === '' ? qui : `${qui}, avec ${aide}`
}

function LigneAction({ uneAction }: { uneAction: ActionPlan }) {
  const urgence = URGENCE[uneAction.signal.urgence]
  return (
    <li className="flex items-start gap-3 border-t border-[var(--color-line)] py-3 first:border-t-0 first:pt-0">
      <span className="flex shrink-0 -space-x-2 pt-0.5">
        {uneAction.aide.map((source) => (
          <Portrait key={source} id={source} taille={24} />
        ))}
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={uneAction.signal.href}
          className="text-sm font-medium text-[var(--color-ink)] no-underline hover:underline"
        >
          {uneAction.signal.titre}
        </a>
        <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-soft)]">
          <span>{quiFait(uneAction)}</span>
          <span aria-hidden="true">·</span>
          <span>effort {AMPLEUR[uneAction.signal.effort]?.toLowerCase()}</span>
          {urgence?.ton === 'critical' ? <Badge tone="critical">{urgence.label}</Badge> : null}
        </p>
      </div>
    </li>
  )
}

/**
 * Le plan, en trois horizons.
 *
 * Une période vide s'affiche vide, avec une phrase : c'est une information — il n'y a rien
 * d'urgent — et la remplir pour la symétrie serait précisément ce que le cahier des
 * charges interdit.
 */
export function PlanOria({ plan }: { plan: PlanMarketing }) {
  const periodes: { titre: string; vide: string; actions: ActionPlan[] }[] = [
    { titre: 'Aujourd’hui', vide: 'Rien ne presse aujourd’hui.', actions: plan.aujourdhui },
    {
      titre: 'Cette semaine',
      vide: 'Rien d’autre cette semaine : les points restants demandent plus de travail.',
      actions: plan.semaine,
    },
    { titre: 'Ce mois', vide: 'Rien de plus pour ce mois.', actions: plan.mois },
  ]
  return (
    <div className="grid gap-4">
      {periodes.map((periode) => (
        <Card key={periode.titre}>
          <CardBody>
            <h2 className="m-0 mb-3 text-base font-semibold">{periode.titre}</h2>
            {periode.actions.length === 0 ? (
              <p className="m-0 text-sm text-[var(--color-ink-soft)]">{periode.vide}</p>
            ) : (
              <ol className="m-0 grid list-none gap-0 p-0">
                {periode.actions.map((uneAction) => (
                  <LigneAction key={uneAction.signal.cle} uneAction={uneAction} />
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

/**
 * « Ma semaine avec Oria » : les mêmes actions, posées sur les jours.
 *
 * Seuls les jours qui ont quelque chose s'affichent. Une semaine à deux actions montre
 * deux jours, et c'est exactement ce qu'elle doit montrer.
 */
export function SemaineOria({ jours }: { jours: readonly JourSemaine[] }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Ma semaine avec Oria</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
          Ce qui compte cette semaine, réparti pour ne pas tout faire le lundi. Recalculé à
          chaque visite : ce que vous réglez disparaît, la suite remonte.
        </p>
        {jours.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-ink-soft)]">
            Rien à planifier cette semaine.
          </p>
        ) : (
          <ol className="m-0 grid list-none gap-4 p-0">
            {jours.map((jour) => (
              <li key={jour.jour} className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                <p className="m-0 text-sm font-semibold">{jour.jour}</p>
                <ul className="m-0 grid list-none gap-0 p-0">
                  {jour.actions.map((uneAction) => (
                    <LigneAction key={uneAction.signal.cle} uneAction={uneAction} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Les onglets d'Oria.
 *
 * L'adresse les porte : un onglet se met en favori et survit au rafraîchissement.
 */
export function OngletsOria({
  courant,
  locale,
  siteId,
}: {
  courant: 'cockpit' | 'plan' | 'rapports' | 'decisions'
  locale: string
  siteId: string
}) {
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  const onglets = [
    { cle: 'cockpit', label: 'Cockpit', href: `/${locale}/oria${suffixe}` },
    { cle: 'plan', label: 'Objectifs et plan', href: `/${locale}/oria/plan${suffixe}` },
    { cle: 'rapports', label: 'Rapport de la semaine', href: `/${locale}/oria/rapports${suffixe}` },
    { cle: 'decisions', label: 'Décisions', href: `/${locale}/oria/decisions${suffixe}` },
  ] as const
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Oria">
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

// ── Rapport ──────────────────────────────────────────────────────────────────

function chiffre(valeur: number | null, unite: string): string {
  if (valeur === null) return '—'
  const texte = new Intl.NumberFormat('fr-CH', {
    maximumFractionDigits: unite === '' ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(valeur)
  return unite === '' ? texte : `${texte} ${unite}`
}

/** Un écart en pour cent, sans « −0 % » : ce qui ne bouge pas n'a pas de signe. */
function ecartLisible(ecart: number): string {
  const pourcent = Math.round(Math.abs(ecart) * 100)
  if (pourcent === 0) return '0 %'
  return `${ecart > 0 ? '+' : '−'}${pourcent} %`
}

const SENS: Record<string, { label: string; ton: 'positive' | 'critical' | 'neutral' | 'brand' }> = {
  mieux: { label: 'En mieux', ton: 'positive' },
  'moins-bien': { label: 'En moins bien', ton: 'critical' },
  stable: { label: 'Stable', ton: 'neutral' },
  neutre: { label: '', ton: 'neutral' },
  nouveau: { label: 'Nouveau', ton: 'brand' },
}

function LigneResultat({ resultat }: { resultat: Resultat }) {
  const sens = SENS[resultat.sens]
  return (
    <tr className="border-t border-[var(--color-line)]">
      <th scope="row" className="py-2 pr-3 text-left text-sm font-normal">
        {resultat.quoi}
      </th>
      <td className="py-2 pr-3 text-right text-sm text-[var(--color-ink-soft)] tabular-nums">
        {chiffre(resultat.avant, resultat.unite)}
      </td>
      <td className="py-2 pr-3 text-right text-sm font-medium tabular-nums">
        {chiffre(resultat.apres, resultat.unite)}
      </td>
      <td className="py-2 text-right text-sm">
        {resultat.ecart === null ? null : (
          <span className="mr-2 text-xs text-[var(--color-ink-soft)] tabular-nums">
            {ecartLisible(resultat.ecart)}
          </span>
        )}
        {sens === undefined || sens.label === '' ? null : <Badge tone={sens.ton}>{sens.label}</Badge>}
      </td>
    </tr>
  )
}

function Liste({ titre, lignes, vide }: { titre: string; lignes: readonly string[]; vide: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 mb-3 text-base font-semibold">{titre}</h2>
        {lignes.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-ink-soft)]">{vide}</p>
        ) : (
          <ul className="m-0 grid list-disc gap-1.5 pl-5 text-sm leading-relaxed">
            {lignes.map((ligne) => (
              <li key={ligne}>{ligne}</li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Le rapport de la semaine, entièrement calculé.
 *
 * Les résultats sont un tableau parce que ce sont des chiffres qu'on compare : une ligne
 * par mesure, la semaine d'avant, celle-ci, l'écart. Le reste est en listes courtes.
 * Actions et résultats sont présentés séparément, sans flèche de l'un vers l'autre : on ne
 * sait pas ce qui a causé quoi, et la mise en page ne doit pas le suggérer.
 */
export function RapportOria({ rapport, maintenant }: { rapport: RapportSemaine; maintenant: Date }) {
  const periode = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long' })
  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">
        Du {periode.format(rapport.depuis)} au {periode.format(rapport.jusqua)}, comparé aux
        sept jours d’avant.
      </p>

      <Card>
        <CardBody>
          <h2 className="m-0 mb-3 text-base font-semibold">Résultats</h2>
          {rapport.resultats.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">
              Aucun chiffre à comparer cette semaine : aucune publicité n’est reliée.
            </p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-xs text-[var(--color-ink-faint)]">
                    <th scope="col" className="pb-2 text-left font-normal">Mesure</th>
                    <th scope="col" className="pb-2 pr-3 text-right font-normal">Semaine d’avant</th>
                    <th scope="col" className="pb-2 pr-3 text-right font-normal">Cette semaine</th>
                    <th scope="col" className="pb-2 text-right font-normal">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {rapport.resultats.map((resultat) => (
                    <LigneResultat key={resultat.quoi} resultat={resultat} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Un écart de moins d’un quart d’une semaine sur l’autre est affiché « stable » : c’est
            du bruit. La dépense n’est jamais jugée — c’est une décision, pas un résultat.
          </p>
        </CardBody>
      </Card>

      <Liste titre="Victoires" lignes={rapport.victoires} vide="Rien de notable en mieux cette semaine." />
      <Liste
        titre="Points d’attention"
        lignes={rapport.attention}
        vide="Rien de notable en moins bien cette semaine."
      />

      <Card>
        <CardBody>
          <h2 className="m-0 mb-3 text-base font-semibold">Actions réalisées</h2>
          {rapport.actions.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">Aucune action enregistrée cette semaine.</p>
          ) : (
            <ol className="m-0 grid list-none gap-3 p-0">
              {rapport.actions.map((action, rang) => (
                <li key={`${+action.quand}-${rang}`} className="flex items-start gap-3">
                  <Portrait id={action.qui} taille={24} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm leading-snug">{action.quoi}</p>
                    <p className="m-0 text-[11px] text-[var(--color-ink-faint)]">{depuis(action.quand, maintenant)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Les résultats ci-dessus sont des évolutions observées, pas des effets démontrés : sur
            une semaine, personne ne peut isoler ce qu’une modification a produit.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="m-0 mb-3 text-base font-semibold">Priorités de la semaine prochaine</h2>
          {rapport.priorites.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">Rien n’attend de décision.</p>
          ) : (
            <ol className="m-0 grid list-none gap-0 p-0">
              {rapport.priorites.map((uneAction) => (
                <LigneAction key={uneAction.signal.cle} uneAction={uneAction} />
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {rapport.absents.length === 0 ? null : (
        <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Ce que ce rapport ne couvre pas : {rapport.absents.join(' ')}
        </p>
      )}
    </div>
  )
}

// ── Décisions ────────────────────────────────────────────────────────────────

const GENRE_DECISION: Record<string, { label: string; ton: 'positive' | 'neutral' | 'brand' | 'caution' }> = {
  appliquee: { label: 'Appliquée', ton: 'brand' },
  corrigee: { label: 'Corrigée', ton: 'brand' },
  publiee: { label: 'Publiée', ton: 'brand' },
  ecartee: { label: 'Écartée', ton: 'neutral' },
  annulee: { label: 'Défaite ensuite', ton: 'caution' },
}

function ImpactVu({ impact }: { impact: Impact }) {
  if (impact.etat === 'indisponible') {
    return <p className="m-0 text-xs text-[var(--color-ink-faint)]">{impact.raison}</p>
  }
  if (impact.etat === 'en-attente') {
    return (
      <p className="m-0 text-xs text-[var(--color-ink-soft)]">
        Mesure en attente{impact.disponibleLe === null ? '' : ` jusqu’au ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long' }).format(impact.disponibleLe)}`}.{' '}
        {impact.raison}
      </p>
    )
  }
  return (
    <div className="grid gap-1">
      <p className="m-0 text-xs text-[var(--color-ink-soft)]">
        Évolution observée après, sur {impact.portee} ({impact.fenetre}) :
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {impact.mesures.map((mesure) => {
          const sens = SENS[mesure.sens]
          return (
            <li key={mesure.quoi} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-[var(--color-ink-soft)]">{mesure.quoi} :</span>
              <span className="tabular-nums">{chiffre(mesure.avant, mesure.unite)}</span>
              <span aria-hidden="true">→</span>
              <span className="font-medium tabular-nums">{chiffre(mesure.apres, mesure.unite)}</span>
              {mesure.ecart === null ? null : (
                <span className="text-xs text-[var(--color-ink-soft)] tabular-nums">({ecartLisible(mesure.ecart)})</span>
              )}
              {sens === undefined || sens.label === '' ? null : <Badge tone={sens.ton}>{sens.label}</Badge>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Le journal des décisions.
 *
 * Chaque ligne dit ce qui a été décidé, qui l'avait proposé, et ce qu'on a observé après —
 * jamais ce que la décision a « produit ». Ce qui a été écarté y figure aussi : c'est une
 * décision, et c'est ce qui empêche Oria de reproposer chaque matin ce qu'on a déjà refusé.
 */
export function DecisionsOria({ decisions }: { decisions: readonly Decision[] }) {
  const date = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long' })
  if (decisions.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Aucune décision sur les trois derniers mois. Elles apparaîtront ici dès que vous
            validerez une proposition d’un spécialiste, marquerez une correction faite ou
            écarterez une recommandation.
          </p>
        </CardBody>
      </Card>
    )
  }
  return (
    <ol className="m-0 grid list-none gap-3 p-0">
      {decisions.map((decision) => {
        const genre = GENRE_DECISION[decision.genre]
        return (
          <li key={decision.cle}>
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--color-ink-faint)]">{date.format(decision.quand)}</span>
                  {genre === undefined ? null : <Badge tone={genre.ton}>{genre.label}</Badge>}
                </div>
                <p className="mt-2 mb-0 text-sm font-medium leading-snug">{decision.quoi}</p>
                <p className="mt-1 mb-0 flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                  <span className="flex -space-x-2">
                    {decision.proposePar.map((source) => (
                      <Portrait key={source} id={source} taille={20} />
                    ))}
                  </span>
                  Proposé par {nommer(decision.proposePar)}
                </p>
                {decision.impact === null ? null : (
                  <div className="mt-3 border-t border-[var(--color-line)] pt-3">
                    <ImpactVu impact={decision.impact} />
                  </div>
                )}
              </CardBody>
            </Card>
          </li>
        )
      })}
    </ol>
  )
}
