import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { hasConnection } from '@/server/integrations/service'
import { listerComptesRelies } from '@/server/ads/comptes'
import { metaAds } from '@/server/ads/meta-ads'
import { findVisibilityAgent } from '@/server/agents/visibility'
import { withUserScope } from '@/server/db/scope'
import { NIVEAU_CAMPAGNE } from '@/server/ads/niveaux'
import {
  lireTableauMeta,
  periodeMetaValide,
  PERIODES_META,
  synthese,
} from '@/server/ads/tableau-meta'
import { lireRecommandationsMeta } from '@/server/ads/recommandations-meta'
import { droitsMeta } from '@/server/ads/droits-meta'
import { autoriseMeta } from '@/server/ads/garde-fous-meta'
import { contexteActionsMeta, proposerActionMeta } from '@/server/ads/actions-meta'
import { journalMeta } from '@/server/ads/envoi-meta'
import { isEnabled } from '@/server/settings/flags'
import { Shell } from '@/components/studio/Shell'
import { AgentAvatar } from '@/components/marketing/visibility'
import { ComptesAds } from '@/components/studio/ComptesAds'
import { ProfilAds } from '@/components/studio/ProfilAds'
import { ModeAds } from '@/components/studio/ModeAds'
import { JournalMeta } from '@/components/studio/JournalMeta'
import { LireMeta } from '@/components/studio/LireMeta'
import { ConstatsMeta } from '@/components/studio/ConstatsMeta'
import { TableauMeta } from '@/components/studio/TableauMeta'
import { LinkButton } from '@/components/ui'

/**
 * La page de MIRA.
 *
 * Elle a été réécrite après un premier essai qu'on a trouvé, à juste titre, difficile à
 * prendre en main. Le défaut n'était pas le contenu mais l'ordre : des explications avant
 * les chiffres, des chiffres avant ce qu'il faut en faire, et la mise en route mêlée à
 * l'usage quotidien. On y trouvait tout, et rien du premier coup d'œil.
 *
 * Trois règles pour la suite.
 *
 * **La mise en route se voit tant qu'elle n'est pas finie, et disparaît ensuite.** Quatre
 * étapes, une seule action mise en avant à la fois. Une fois toutes franchies, le bandeau
 * s'efface : ce qui ne sert plus ne doit plus occuper le haut de l'écran.
 *
 * **Ce qu'il faut faire passe avant l'état des lieux.** C'est la question qu'on se pose en
 * ouvrant la page, pas celle qu'on se pose après avoir lu trois tableaux.
 *
 * **Les réglages se replient.** Choisir son compte, relire ses chiffres, comprendre ce que
 * l'autorisation Meta donne : trois gestes rares, qui n'ont pas à encombrer les gestes
 * fréquents. Ils restent atteignables en un clic, à leur place, en bas.
 */

/** Comment nommer une fenêtre, en français et sans arithmétique mentale. */
const NOM_PERIODE: Record<number, string> = {
  1: 'Hier',
  3: '3 jours',
  7: '7 jours',
  14: '14 jours',
  30: '30 jours',
}

/**
 * Le chemin jusqu'au premier chiffre utile.
 *
 * Visible tant qu'une étape manque, et il en désigne **une seule** : celle qu'il faut faire
 * maintenant. Quatre boutons offerts ensemble à quelqu'un qui découvre l'écran, c'est quatre
 * façons de se tromper d'ordre.
 */
function Parcours({
  etapes,
}: {
  etapes: Array<{ nom: string; fait: boolean; action?: { texte: string; href: string } }>
}) {
  const restantes = etapes.filter((etape) => !etape.fait)
  if (restantes.length === 0) return null
  const suivante = restantes[0]

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-brand-soft)] p-5">
      <h2 className="m-0 text-base font-semibold">Mise en route</h2>

      <ol className="mt-3 mb-0 flex flex-wrap list-none gap-x-5 gap-y-2 p-0 text-sm">
        {etapes.map((etape) => (
          <li
            key={etape.nom}
            className={`flex items-center gap-2 ${
              etape.fait ? 'text-[var(--color-ink-soft)]' : 'font-medium'
            }`}
          >
            <span
              aria-hidden="true"
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]"
              style={{
                backgroundColor: etape.fait ? 'var(--color-positive)' : 'var(--color-line)',
                color: etape.fait ? '#fff' : 'var(--color-ink-soft)',
              }}
            >
              {etape.fait ? '✓' : ''}
            </span>
            {etape.nom}
          </li>
        ))}
      </ol>

      {suivante?.action === undefined ? null : (
        <LinkButton href={suivante.action.href} className="mt-4">
          {suivante.action.texte}
        </LinkButton>
      )}
    </section>
  )
}

export default async function ComptesMetaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ jours?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const mira = findVisibilityAgent('meta')
  const [credits, entitlements] = await Promise.all([
    availableCredits(user.id),
    getEntitlements(user.id),
  ])

  /*
   * Le droit vérifié est celui de l'agent publicitaire, et non `visibility_meta_agent` : la
   * fiche de MIRA est encore « prévue », et verrouiller sur un droit que personne ne possède
   * fermerait l'écran à celui-là même qui vient de relier son compte.
   */
  const ouvert = entitlements.granted.includes('visibility_ads_agent')
  const [relie, comptes] = ouvert
    ? await Promise.all([
        hasConnection(user.id, metaAds.id),
        listerComptesRelies(user.id, metaAds.id),
      ])
    : [false, []]

  const actif = comptes.find((compte) => compte.actif) ?? null
  const jours = periodeMetaValide((await searchParams).jours)

  /*
   * Compté sur ce qui est réellement en base, et non sur ce que Meta a répondu : annoncer
   * quatre campagnes d'après la réponse ferait diverger l'écran de la vérité au premier
   * rattachement manqué. Les journées ne comptent que l'étage campagne — sinon elles
   * compteraient trois fois les mêmes.
   */
  const lu =
    actif === null
      ? null
      : await withUserScope(user.id, async (tx) => ({
          campagnes: await tx.adsCampagne.count({ where: { accountId: actif.id } }),
          ensembles: await tx.adsGroupe.count({ where: { accountId: actif.id } }),
          annonces: await tx.adsAnnonce.count({ where: { accountId: actif.id } }),
          journees: await tx.adsReleve.count({
            where: { accountId: actif.id, ...NIVEAU_CAMPAGNE },
          }),
        }))

  const tableau =
    actif === null || lu === null || lu.journees === 0
      ? null
      : await lireTableauMeta(user.id, jours).catch(() => null)

  /*
   * Les constats sont relus, pas recalculés. Ils ont été rangés par la lecture des chiffres
   * et par la tournée nocturne, ce qui leur donne trois choses qu'un calcul à l'affichage ne
   * peut pas avoir : un âge, une mémoire de ce qui a été écarté, et une indépendance vis-à-vis
   * de la période cochée plus bas — les règles jugent sur quatorze jours, toujours les mêmes.
   */
  const constats =
    tableau === null ? [] : await lireRecommandationsMeta(user.id, tableau.compte.id)

  /*
   * Ce que MIRA enverrait, et si elle a le droit de l'envoyer.
   *
   * Monté sur les chiffres du jour et non sur ceux du constat : un constat ouvert il y a
   * douze jours porte le budget de ce jour-là, et rejouer ce chiffre ferait passer une
   * division par deux pour un palier. Voir `actions-meta.ts`.
   *
   * Le contexte est lu une fois pour tout le compte : un écran qui affiche huit constats
   * ferait sinon vingt-quatre allers-retours pour composer huit phrases.
   */
  const droits = tableau === null ? null : await droitsMeta(user.id)
  const contexte =
    tableau === null ? null : await contexteActionsMeta(user.id, tableau.compte.id)

  /*
   * Les écritures déjà faites aujourd'hui : c'est une des bornes, et elle se compte sur le
   * journal plutôt que sur un compteur tenu à part — deux nombres qui disent la même chose
   * finissent toujours par se contredire.
   */
  const debutDuJour = new Date()
  debutDuJour.setHours(0, 0, 0, 0)
  const faitesAujourdhui =
    tableau === null
      ? 0
      : await withUserScope(user.id, (tx) =>
          tx.adsAction.count({
            where: { accountId: tableau.compte.id, createdAt: { gte: debutDuJour } },
          }),
        )

  const cadre =
    tableau === null || droits === null
      ? null
      : {
          mode: tableau.compte.mode,
          devise: tableau.compte.devise,
          profil: tableau.profil,
          droits,
          faitesAujourdhui,
        }

  /*
   * Le verdict commun, calculé une fois. Quand il refuse, il refuse pour tous les constats
   * de la même façon — le dire huit fois de suite ferait de la page un mur de rouge pour un
   * seul problème, et on cesserait de lire les refus qui, eux, sont propres à un objet.
   */
  /*
   * L'interrupteur d'exploitation passe avant tout le reste : quand l'écriture Meta est
   * fermée pour tout le monde, il n'y a pas lieu d'expliquer à quelqu'un que son compte est
   * en lecture — il changerait un réglage qui n'y changerait rien.
   */
  const ecritureOuverte = await isEnabled('publiciteEcritureMeta')
  const blocage =
    cadre === null
      ? null
      : !ecritureOuverte
        ? {
            ok: false as const,
            raison:
              'L’envoi de modifications vers Meta n’est pas encore ouvert sur cette installation d’Evoliia. MIRA lit et propose ; rien ne part.',
          }
        : autoriseMeta({ ...cadre })

  const journal =
    tableau === null ? [] : await journalMeta(user.id, tableau.compte.id).catch(() => [])

  const propositions =
    cadre === null || contexte === null
      ? []
      : constats.map((constat) => {
          const issue = proposerActionMeta(constat, contexte, cadre)
          if (issue.etat === 'aucune') return { id: constat.id, etat: 'aucune' as const }
          return {
            id: constat.id,
            etat: issue.etat,
            resume: issue.action.resume,
            // Le motif commun est déjà dit en haut : ici, seuls les refus propres à l'objet.
            raison: issue.etat === 'refusee' && blocage?.ok === true ? issue.raison : '',
          }
        })

  const objectifsPoses =
    tableau !== null && (tableau.profil.roasCible > 0 || tableau.profil.cpaCible > 0)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="publicite"
    >
      <div className="mx-auto w-full max-w-4xl px-5 py-10">
        <a
          href={`/${locale}/publicite`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Publicité
        </a>

        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">MIRA — Meta Ads</h1>

        {/*
          MIRA parle avant que l'écran ne montre quoi que ce soit.
          
          On ouvre cette page pour savoir si tout va bien, et cette question mérite une
          phrase, pas une grille à déchiffrer. Le texte est écrit par du code aujourd'hui —
          aucun chiffre inventé, aucun jugement que ceux déjà rendus ligne par ligne — et
          MIRA le remplacera par le sien quand elle saura parler, à partir des mêmes chiffres.
        */}
        <div className="mt-4 flex flex-wrap items-start gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          {mira === undefined ? null : <AgentAvatar agent={mira} size="md" />}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-medium">
              {tableau === null ? 'MIRA vous accompagne' : 'MIRA surveille vos campagnes'}
            </p>
            <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {tableau === null
                ? 'Reliez votre compte Meta et lisez vos campagnes : je vous dirai alors où va votre budget, ce qui fonctionne, et ce qu’on peut améliorer.'
                : synthese(tableau, constats)}
            </p>
            {actif?.synchroAt === undefined || actif.synchroAt === null ? null : (
              <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
                Chiffres lus le {actif.synchroAt.toLocaleDateString(locale)}
              </p>
            )}
          </div>
        </div>

        {!ouvert ? (
          <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm font-medium">Votre offre n’ouvre pas la publicité.</p>
            <LinkButton href={`/${locale}/abonnement`} variant="secondary" className="mt-3">
              Voir les offres
            </LinkButton>
          </div>
        ) : (
          <div className="mt-8 grid gap-8">
            <Parcours
              etapes={[
                {
                  nom: 'Compte Meta relié',
                  fait: relie,
                  action: { texte: 'Connecter Meta Ads', href: `/${locale}/connexions` },
                },
                {
                  nom: 'Compte choisi',
                  fait: actif !== null,
                  action: {
                    texte: 'Choisir le compte plus bas',
                    href: `/${locale}/publicite/meta#reglages`,
                  },
                },
                {
                  nom: 'Chiffres lus',
                  fait: tableau !== null,
                  action: {
                    texte: 'Lire mes campagnes plus bas',
                    href: `/${locale}/publicite/meta#reglages`,
                  },
                },
                /*
                 * Les objectifs ne sont plus une étape de mise en route.
                 *
                 * Ils y figuraient, et le même bouton se retrouvait deux fois à l'écran : ici,
                 * et dans le bandeau qui explique pourquoi ils comptent. Deux appels
                 * identiques à quelques centimètres l'un de l'autre font hésiter au lieu de
                 * guider — on cherche la différence, il n'y en a pas. Le bandeau reste, parce
                 * que lui dit pourquoi ; celui-ci part, parce qu'il ne disait que quoi.
                 */
              ]}
            />

            {tableau === null ? null : (
              <>
                {/*
                  Ce qu'il faut faire avant l'état des lieux : c'est la question qu'on se pose
                  en ouvrant la page, pas celle qu'on se pose après avoir lu trois tableaux.
                  Le sélecteur de période est plus bas parce qu'il ne commande que le tableau —
                  les constats, eux, sont jugés sur une fenêtre fixe.
                */}
                <ConstatsMeta
                  initiaux={constats}
                  propositions={propositions}
                  blocage={blocage !== null && !blocage.ok ? blocage.raison : ''}
                />

                {/*
                  Le journal sous les constats : ce qu'on a fait se lit après ce qu'il reste à
                  faire, et avant les chiffres qui en portent déjà l'effet.
                */}
                <JournalMeta
                  initiales={journal.map((une) => ({
                    ...une,
                    createdAt: une.createdAt.toISOString(),
                  }))}
                />

                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="m-0 text-sm text-[var(--color-ink-soft)]">
                    {actif?.nom} · {NOM_PERIODE[jours] ?? `${jours} jours`}
                  </p>
                  <nav className="flex flex-wrap gap-2" aria-label="Choisir la période">
                    {PERIODES_META.map((periode) => {
                      const courante = periode === jours
                      return (
                        <a
                          key={periode}
                          href={`/${locale}/publicite/meta?jours=${periode}`}
                          aria-current={courante ? 'true' : undefined}
                          className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
                            courante
                              ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                              : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
                          }`}
                        >
                          {NOM_PERIODE[periode] ?? `${periode} j`}
                        </a>
                      )
                    })}
                  </nav>
                </div>

                {objectifsPoses ? null : (
                  <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-caution-soft)] p-4">
                    <p className="m-0 text-sm leading-relaxed">
                      Vous n’avez pas encore posé d’objectif. MIRA montre vos chiffres, mais
                      elle ne les juge pas : un coût par vente de 37 n’est ni bon ni mauvais
                      tant qu’on ignore votre marge et votre panier moyen.
                    </p>
                    <LinkButton
                      href={`/${locale}/publicite/meta#objectifs`}
                      variant="secondary"
                      className="mt-3"
                    >
                      Renseigner mes objectifs
                    </LinkButton>
                  </div>
                )}

                <TableauMeta vue={tableau} />
              </>
            )}

            {/*
              Les objectifs, et ils sont ceux de ce compte-ci.
              
              Le bouton du bandeau renvoyait vers la page de Naya, où le même formulaire
              enregistrait sur le compte Google : on remplissait, le formulaire disait
              « enregistré », et MIRA continuait d'afficher qu'il manquait des objectifs. Un
              compte publicitaire porte ses propres chiffres — une marge Meta n'a aucune
              raison d'être celle d'un compte Google, et les deux se saisissent là où on les
              regarde.
            */}
            {tableau === null ? null : (
              <section
                id="objectifs"
                className="min-w-0 scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
              >
                <ProfilAds
                  initial={tableau.profil}
                  devise={tableau.compte.devise}
                  ouvert={!objectifsPoses}
                  plateforme="meta-ads"
                />
              </section>
            )}

            {/*
              Les réglages en bas et repliés : trois gestes rares — choisir son compte,
              relire ses chiffres, comprendre ce que l'autorisation donne — qui n'ont pas à
              encombrer les gestes fréquents. Ouverts d'office tant qu'il n'y a rien à
              montrer, parce que c'est alors le seul endroit où il y a quelque chose à faire.
            */}
            <details
              id="reglages"
              open={tableau === null}
              className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
            >
              <summary className="cursor-pointer list-none text-base font-semibold">
                Réglages et lecture
              </summary>

              {!relie ? (
                <div className="mt-4">
                  <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    Meta Ads n’est pas connecté. En reliant votre compte, Evoliia lit vos
                    campagnes Facebook et Instagram. Aucune modification n’est faite sans
                    votre accord explicite.
                  </p>
                  <LinkButton href={`/${locale}/connexions`} variant="secondary" className="mt-3">
                    Connecter Meta Ads
                  </LinkButton>
                </div>
              ) : (
                <div className="mt-4 grid gap-6">
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-medium">Le compte que MIRA suit</p>
                    <p className="mt-1 mb-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                      Meta donne la liste de tous les comptes sur lesquels vous avez un rôle,
                      y compris ceux d’autres portefeuilles : son autorisation ne se découpe
                      pas. Ce qui limite ce que MIRA voit, c’est le compte choisi ici —
                      aucun autre n’est lu. Deux comptes peuvent porter le même nom, c’est le
                      numéro qui les distingue.
                    </p>
                    <ComptesAds initiaux={comptes} agent="MIRA" plateforme="Meta" />
                  </div>

                  {actif === null ? null : (
                    <div className="min-w-0 border-t border-[var(--color-line)] pt-5">
                      <p className="m-0 mb-3 text-sm font-medium">Ce que MIRA a le droit de faire</p>
                      <ModeAds
                        initial={actif.mode}
                        ouvert={ecritureOuverte}
                        plateforme="meta-ads"
                        agent="MIRA"
                        chez="Meta"
                      />
                    </div>
                  )}

                  {actif === null || lu === null ? null : (
                    <div className="min-w-0 border-t border-[var(--color-line)] pt-5">
                      <p className="m-0 text-sm font-medium">Ce que MIRA a lu</p>
                      <p className="mt-1 mb-3 text-xs text-[var(--color-ink-faint)]">
                        {actif.synchroAt === null
                          ? 'Aucune lecture n’a encore eu lieu.'
                          : `Dernière lecture : ${actif.synchroAt.toLocaleString(locale)}.`}
                        {' '}
                        {lu.campagnes} campagnes · {lu.ensembles} ensembles · {lu.annonces}{' '}
                        annonces · {lu.journees} journées.
                      </p>
                      <LireMeta premiere={actif.synchroAt === null} />
                      {/*
                        Ce que Meta a réellement accordé, et non ce qu'Evoliia a demandé.
                        L'écran de consentement de Meta permet de décocher une permission à
                        la volée : sans cette ligne, on découvrirait l'amputation au premier
                        bouton, sur un refus incompréhensible.
                      */}
                      {droits === null ? null : (
                        <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
                          <strong>Ce que Meta autorise :</strong>{' '}
                          {droits.lire ? 'lire vos campagnes' : 'rien pour l’instant'}
                          {droits.ecrire
                            ? ', et les modifier après votre accord.'
                            : '. Meta n’a pas accordé le droit de les modifier — MIRA ne pourra que proposer. Reconnectez votre compte en laissant cochée l’autorisation « gérer les publicités » pour y remédier.'}
                        </p>
                      )}
                      <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
                        La première lecture remonte 90 jours pour les campagnes et 28 pour le
                        détail. L’archivé et le supprimé sont écartés : on ne peut rien en
                        faire. Les chiffres suivent la fenêtre d’attribution de votre compte
                        Meta, celle-là même que montre votre gestionnaire.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </details>
          </div>
        )}
      </div>
    </Shell>
  )
}
