import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { listSites } from '@/server/audit/service'
import { VISIBILITY_ASK_ESTIMATED_CREDITS } from '@/server/agents/visibility-service'
import { FRAICHEUR_MS } from '@/server/nova/collecte'
import { lireNova, quandLisible } from '@/server/nova/service'
import { Shell } from '@/components/studio/Shell'
import { Card, CardBody, LinkButton } from '@/components/ui'
import { SynchroNova } from '@/components/studio/SynchroNova'
import {
  AccueilNova,
  AlertesNova,
  AttributionNova,
  CampagnesNova,
  CanauxNova,
  EnteteNova,
  IndicateursNova,
  InsightsNova,
  OpportunitesNova,
  ParlerANova,
  PeriodeNova,
  PourOriaNova,
  ProduitsNova,
  SanteNova,
} from '@/components/studio/Nova'

/**
 * L'espace de Nova : ce qui rapporte réellement.
 *
 * L'écran répond dans l'ordre aux six questions qu'on se pose en l'ouvrant : combien j'ai
 * vendu, combien j'ai dépensé, ce qui marche, ce qui marche moins, ce qui a changé, où
 * regarder. Les chiffres d'abord, puis les alertes, puis ce que Nova en tire.
 *
 * **Rien ici ne coûte un crédit, et rien n'appelle une régie.** Les chiffres sont relus en
 * base, calculés par du code. Seules les ventes Shopify peuvent être relues à l'ouverture,
 * et seulement si elles ont plus de douze heures. La conversation, elle, se paie — elle
 * seule appelle un modèle.
 */
export const maxDuration = 60

export default async function NovaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; periode?: string; du?: string; au?: string; regie?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, sites, droits] = await Promise.all([availableCredits(user.id), listSites(user.id), getEntitlements(user.id)])
  const ouvert = droits.granted.includes('nova_agent')
  const vue = ouvert
    ? await lireNova(user.id, locale, { periode: demande.periode, du: demande.du, au: demande.au, siteId: demande.siteId })
    : null
  const siteId = vue?.siteId ?? sites.find((site) => site.id === demande.siteId)?.id ?? sites[0]?.id ?? ''
  const suffixe = siteId === '' ? '' : `siteId=${siteId}`
  const siteAnalyse = sites.find((site) => site.id === siteId)
  const versConversation = siteId === '' ? null : `/${locale}/visibilite/equipe?${suffixe}&agent=nova`
  const maintenant = new Date()

  const filtre = demande.regie === 'google' || demande.regie === 'meta' ? demande.regie : 'toutes'
  const base = `/${locale}/nova`
  const lienRegie = (regie: string) => {
    const parametres = new URLSearchParams()
    if (vue !== null) parametres.set('periode', vue.periode.cle)
    if (vue?.periode.cle === 'perso') {
      parametres.set('du', vue.periode.du)
      parametres.set('au', vue.periode.au)
    }
    if (siteId !== '') parametres.set('siteId', siteId)
    if (regie !== 'toutes') parametres.set('regie', regie)
    return `${base}?${parametres.toString()}#campagnes`
  }

  const ventes = vue?.ventes
  const lireVentes =
    ventes !== undefined &&
    (ventes.etat === 'jamais' || ((ventes.etat === 'ok' || ventes.etat === 'erreur') && (ventes.synchroAt === null || +maintenant - +ventes.synchroAt >= FRAICHEUR_MS)))

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="nova"
      siteId={siteId}
      sites={sites.map((site) => ({ id: site.id, host: site.host }))}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-10">
        <EnteteNova versChiffres="#chiffres" versConversation={versConversation ?? `/${locale}/visibilite`} />

        {vue === null ? (
          <Card>
            <CardBody>
              <p className="m-0 text-sm leading-relaxed">
                Nova n’est pas incluse dans votre offre actuelle. Elle rassemble vos ventes, vos dépenses publicitaires et
                ce que chaque canal rapporte réellement.
              </p>
              <div className="mt-4">
                <LinkButton href={`/${locale}/abonnement`}>Voir les offres</LinkButton>
              </div>
            </CardBody>
          </Card>
        ) : vue.vierge ? (
          <AccueilNova versConnexions={`/${locale}/connexions`} />
        ) : (
          <>
            <div className="grid gap-3">
              <PeriodeNova
                courante={vue.periode.cle}
                libelle={vue.periode.libelle}
                du={vue.periode.du}
                au={vue.periode.au}
                base={{ chemin: base, siteId }}
              />
              {ventes === undefined || ventes.etat === 'absent' || ventes.etat === 'offre' ? null : (
                <SynchroNova derniere={ventes.synchroAt === null ? null : quandLisible(ventes.synchroAt)} aRelire={lireVentes} />
              )}
              <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                Sources : {vue.sources.length === 0 ? 'aucune' : vue.sources.join(' + ')}
                {siteAnalyse === undefined ? '' : ` · site ${siteAnalyse.host}`}
              </p>
            </div>

            <IndicateursNova kpis={vue.kpis} devise={vue.devise} />
            <AlertesNova alertes={vue.alertes} locale={locale} siteId={siteId} />
            <InsightsNova insights={vue.insights} />
            <CanauxNova canaux={vue.canaux} devise={vue.devise} />
            <AttributionNova attribution={vue.attribution} devise={vue.devise} />
            <OpportunitesNova opportunites={vue.opportunites} />
            <CampagnesNova campagnes={vue.campagnes} devise={vue.devise} filtre={filtre} lien={lienRegie} />
            <ProduitsNova produits={vue.produits} devise={vue.devise} />
            <SanteNova global={vue.sante.global} lignes={vue.sante.lignes} />
            <PourOriaNova rapport={vue.pourOria} versOria={`/${locale}/oria${suffixe === '' ? '' : `?${suffixe}`}`} />
            <ParlerANova versConversation={versConversation} cout={VISIBILITY_ASK_ESTIMATED_CREDITS} />
          </>
        )}
      </div>
    </Shell>
  )
}
