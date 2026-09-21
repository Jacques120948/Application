import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { hasConnection } from '@/server/integrations/service'
import { listerComptesRelies } from '@/server/ads/comptes'
import { googleAds } from '@/server/ads/google-ads'
import { findVisibilityAgent } from '@/server/agents/visibility'
import { readDashboard } from '@/server/audit/service'
import { Shell } from '@/components/studio/Shell'
import { AgentAvatar } from '@/components/marketing/visibility'
import { ComptesAds } from '@/components/studio/ComptesAds'
import { TableauAds } from '@/components/studio/TableauAds'
import { LireCampagnes } from '@/components/studio/LireCampagnes'
import { lireTableauAds, periodeValide, triValide } from '@/server/ads/tableau'
import { ObjectifsAds } from '@/components/studio/ObjectifsAds'
import { ProfilAds } from '@/components/studio/ProfilAds'
import { objectifsDuCompte } from '@/server/ads/profil'
import { lireRecommandations, proposerAction } from '@/server/ads/recommandations'
import { lireJournal } from '@/server/ads/actions'
import { isEnabled } from '@/server/settings/flags'
import { ModeAds } from '@/components/studio/ModeAds'
import { JournalAds } from '@/components/studio/JournalAds'
import { RecommandationsAds } from '@/components/studio/RecommandationsAds'
import { LinkButton } from '@/components/ui'

/**
 * La page de Naya.
 *
 * Elle ouvre sur l'état de la connexion, et rien d'autre tant qu'il n'y a pas de chiffres.
 * C'est volontaire : un écran qui montrerait des cases de tableau de bord vides à quelqu'un
 * qui n'a pas encore relié son compte lui ferait croire à une panne, et il chercherait le
 * défaut partout sauf à l'endroit où il est — le bouton qu'il n'a pas encore cliqué.
 *
 * Les campagnes, les indicateurs et les recommandations viendront remplir cette page à
 * mesure qu'ils existeront. Ce qui est affiché est ce qui est construit.
 */
export default async function PublicitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ jours?: string; tri?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [credits, entitlements] = await Promise.all([
    availableCredits(user.id),
    getEntitlements(user.id),
  ])

  const naya = findVisibilityAgent('ads')
  const ouvert = entitlements.granted.includes('visibility_ads_agent')
  const [relie, comptes] = ouvert
    ? await Promise.all([hasConnection(user.id, googleAds.id), listerComptesRelies(user.id)])
    : [false, []]
  const actif = comptes.find((compte) => compte.actif) ?? null

  /*
   * La période voyage dans l'adresse, comme le filtre par pays et le rythme du calendrier :
   * elle se met en favori et survit au rafraîchissement. Une valeur inattendue retombe sur
   * sept jours plutôt que de faire échouer un écran qu'on venait consulter.
   */
  const demande = await searchParams
  const jours = periodeValide(demande.jours)
  const tri = triValide(demande.tri)
  const tableau =
    actif === null ? null : await lireTableauAds(user.id, jours, tri).catch(() => null)

  /*
   * Les objectifs sont lus après le tableau parce qu'ils s'y adossent : le verdict de
   * rentabilité confronte le ROAS de la période affichée au seuil déduit de la marge. Les
   * calculer sur une autre fenêtre que celle qu'on regarde donnerait un verdict qui ne
   * correspond à aucun chiffre visible à l'écran.
   */
  const objectifs =
    tableau === null ? null : await objectifsDuCompte(user.id, tableau.compte, tableau.total)

  /*
   * Les recommandations sont lues, jamais recalculées à l'ouverture. Les recalculer ici
   * ferait reparaître à chaque visite un avis écarté la veille, et écrirait en base sur une
   * simple consultation. Elles sont produites après chaque lecture de campagnes, après
   * chaque changement de marge, et chaque nuit.
   */
  const recommandations =
    tableau === null ? [] : await lireRecommandations(user.id, tableau.compte.id)

  /*
   * L'écriture a deux verrous, et l'écran doit refléter les deux : l'interrupteur
   * d'exploitation, qui vaut pour toute l'installation, et le mode du compte, que la
   * personne règle elle-même. Un bouton « appliquer » visible alors que l'un des deux est
   * fermé serait un bouton qui déçoit au clic.
   */
  /*
   * Le site sert seulement à ouvrir la conversation avec Naya : l'équipe parle d'un site,
   * et sans lui la page d'échange n'a pas de contexte. Absent, on n'affiche pas le lien
   * plutôt que de mener vers un écran qui redirigerait aussitôt.
   */
  const site = ouvert ? await readDashboard(user.id).catch(() => null) : null

  const ecritureOuverte = ouvert ? await isEnabled('publiciteEcriture') : false
  const assiste = ecritureOuverte && tableau !== null && tableau.compte.mode === 'assiste'
  const journal = tableau === null ? [] : await lireJournal(user.id, tableau.compte.id)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
    >
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="flex flex-wrap items-center gap-4">
          {naya === undefined ? null : <AgentAvatar agent={naya} size="lg" halo />}
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Naya — Publicité</h1>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Elle lit vos campagnes Google Ads, explique où part votre argent et ce qu’il
              rapporte, et propose des ajustements. Elle ne modifie rien sans votre accord.
            </p>
            {site === null ? null : (
              <LinkButton
                href={`/${locale}/visibilite/equipe?siteId=${site.site.id}`}
                variant="secondary"
                className="mt-3"
              >
                Parler à Naya
              </LinkButton>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-6">
          {!ouvert ? (
            <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <p className="m-0 text-sm leading-relaxed">
                Naya n’est pas incluse dans votre offre actuelle.
              </p>
              <LinkButton href={`/${locale}/abonnement`} variant="secondary" className="mt-3">
                Voir les offres
              </LinkButton>
            </section>
          ) : !relie ? (
            <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <p className="m-0 text-sm font-medium">Connexion Google Ads requise</p>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Naya ne devine rien : sans vos chiffres, elle n’a ni dépense, ni ROAS, ni
                conversion à commenter. Reliez votre compte pour qu’elle puisse lire.
              </p>
              {/*
                Ce que Google affichera, dit avant qu'on y arrive. L'autorisation Google Ads
                n'existe qu'en version complète : demander à lire, c'est obtenir le droit de
                modifier. La personne doit pouvoir le savoir avant de cliquer, pas le
                découvrir sur l'écran de consentement.
              */}
              <p className="mt-3 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                Google vous demandera d’autoriser « voir, modifier, créer et supprimer vos
                données et comptes Google Ads » : c’est la seule autorisation qu’il propose
                pour cette API, il n’en existe pas de version en lecture seule.{' '}
                <strong>Evoliia ne s’en sert que pour lire.</strong> Toute modification
                demandera votre confirmation, et sa valeur d’avant sera conservée pour
                pouvoir revenir en arrière.
              </p>
              <LinkButton href={`/${locale}/connexions`} className="mt-4">
                Connecter Google Ads
              </LinkButton>
            </section>
          ) : (
            <>
              <section>
                <h2 className="m-0 mb-3 text-base font-semibold">
                  {actif === null ? 'Choisissez le compte à suivre' : 'Compte Google Ads'}
                </h2>
                {comptes.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                    <p className="m-0 text-sm leading-relaxed">
                      L’autorisation est en place, mais aucun compte publicitaire n’a été lu.
                      Vérifiez que le compte Google que vous avez autorisé a bien accès à un
                      compte Google Ads.
                    </p>
                  </div>
                ) : (
                  <ComptesAds initiaux={comptes} />
                )}
              </section>

              {actif === null || tableau === null ? null : (
                <>
                  <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                    <p className="m-0 mb-3 text-xs text-[var(--color-ink-faint)]">
                      {actif.synchroAt === null
                        ? 'Aucune lecture n’a encore eu lieu.'
                        : `Dernière lecture : ${actif.synchroAt.toLocaleString(locale)}.`}
                    </p>
                    <LireCampagnes premiere={actif.synchroAt === null} />
                    {/*
                      Le contenu des campagnes vit sur son propre écran : on n'y vient pas
                      pour la même raison. Les chiffres se regardent le matin, le contenu
                      quand on a décidé d'écrire.
                    */}
                    <LinkButton
                      href={`/${locale}/publicite/annonces`}
                      variant="secondary"
                      className="mt-3"
                    >
                      Vos annonces et ce que les gens tapent
                    </LinkButton>
                  </section>
                  <ModeAds initial={actif.mode} ouvert={ecritureOuverte} />
                  {objectifs === null || !tableau.synchronise ? null : (
                    <ObjectifsAds
                      lecture={objectifs.lecture}
                      marge={objectifs.profil.margePourcent}
                      jours={tableau.jours}
                      ancre="#profil"
                    />
                  )}
                  {objectifs === null || !tableau.synchronise ? null : (
                    <RecommandationsAds
                      ancre="#profil"
                      sansMarge={objectifs.lecture.seuil === null}
                      initiales={recommandations.map((une) => ({
                        id: une.id,
                        regle: une.regle,
                        priorite: une.priorite,
                        titre: une.titre,
                        observation: une.observation,
                        jours: une.jours,
                        risque: une.risque,
                        campagne: une.campagne,
                        /*
                         * L'âge est calculé ici plutôt que dans le navigateur : une date
                         * rendue par le serveur et comparée à l'horloge du poste donne des
                         * « ouvert depuis -1 jour » quand les deux ne sont pas d'accord.
                         */
                        age: Math.max(
                          0,
                          Math.floor((Date.now() - une.createdAt.getTime()) / 86_400_000),
                        ),
                        /*
                         * Montée sur la campagne telle qu'elle est maintenant, et non sur
                         * ce que la règle avait vu : un constat ouvert il y a douze jours
                         * porte le budget de ce jour-là, et proposer « 15 → 18 » alors qu'il
                         * est à 40 depuis serait nommer hausse une baisse.
                         */
                        action: proposerAction(une, tableau.campagnes, tableau.compte.devise),
                      }))}
                      assiste={assiste}
                    />
                  )}
                  <TableauAds
                    base={`/${locale}/publicite`}
                    assiste={assiste}
                    tableau={{
                      devise: tableau.compte.devise,
                      jours: tableau.jours,
                      depuis: tableau.depuis,
                      jusqua: tableau.jusqua,
                      total: tableau.total,
                      ecarts: tableau.ecarts,
                      campagnes: tableau.campagnes,
                      serie: tableau.serie,
                      tri: tableau.tri,
                      synchronise: tableau.synchronise,
                    }}
                  />
                  {journal.length === 0 && !assiste ? null : (
                    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                      <JournalAds
                        initiales={journal.map((une) => ({
                          id: une.id,
                          quoi: une.quoi,
                          motif: une.motif,
                          mode: une.mode,
                          resultat: une.resultat,
                          detail: une.detail,
                          campagne: une.campagne,
                          quand: une.createdAt.toLocaleString(locale),
                          annulee: une.annulee,
                          restauration: une.restauration,
                        }))}
                      />
                    </section>
                  )}
                  {objectifs === null ? null : (
                    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                      <ProfilAds
                        initial={objectifs.profil}
                        devise={tableau.compte.devise}
                        ouvert={!objectifs.renseigne}
                      />
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  )
}
