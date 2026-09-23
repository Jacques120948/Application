import { ecranDuMembre, membre, type IdMembre } from '@/lib/equipe'
import { Badge, Card, CardBody, LinkButton } from '@/components/ui'
import type { Signal } from '@/server/oria/signaux'
import type { Canal } from '@/server/oria/sante'
import type { EtatAgent } from '@/server/oria/cockpit'
import type { Evenement } from '@/server/oria/activite'

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
export function CartePriorite({ signal, rang }: { signal: Signal; rang: number }) {
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
 * Uniquement des événements enregistrés. Aucune ligne du type « Oria a demandé à Cleo… » :
 * Oria ne demande encore rien à personne, et l'écrire serait mettre en scène un travail
 * qui n'a pas eu lieu.
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
