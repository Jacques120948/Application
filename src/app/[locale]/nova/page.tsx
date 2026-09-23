import { VISIBILITY_ASK_ESTIMATED_CREDITS } from '@/server/agents/visibility-service'
import { FRAICHEUR_MS } from '@/server/nova/collecte'
import { lireNova, quandLisible } from '@/server/nova/service'
import { SynchroNova } from '@/components/studio/SynchroNova'
import {
  AccueilNova,
  AlertesNova,
  AVenirNova,
  AttributionNova,
  CampagnesNova,
  CanauxNova,
  IndicateursNova,
  InsightsNova,
  ObjectifsNova,
  OpportunitesNova,
  ParlerANova,
  PeriodeNova,
  PourOriaNova,
  ProduitsNova,
  SanteNova,
  VisitesNova,
} from '@/components/studio/Nova'
import { ProprieteGa4 } from '@/components/studio/ProprieteGa4'
import { CadreNova, ouvrirNova } from './cadre'

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
  const demande = await searchParams
  const contexte = await ouvrirNova(params, demande.siteId)
  const { locale, user, sites, ouvert } = contexte
  const vue = ouvert
    ? await lireNova(user.id, locale, { periode: demande.periode, du: demande.du, au: demande.au, siteId: contexte.siteId })
    : null
  const siteId = vue?.siteId ?? contexte.siteId
  const suffixe = siteId === '' ? '' : `siteId=${siteId}`
  const siteAnalyse = sites.find((site) => site.id === siteId)
  const versConversation = siteId === '' ? null : `/${locale}/visibilite/equipe?${suffixe}&agent=nova`
  const maintenant = new Date()

  // Transmettre à un spécialiste passe par sa conversation, qui vit sur un site analysé.
  const transmission =
    siteId === ''
      ? undefined
      : {
          siteId,
          locale,
          cout: VISIBILITY_ASK_ESTIMATED_CREDITS,
          versConversation: `/${locale}/visibilite/equipe?${suffixe}&agent=`,
          periode: { periode: vue?.periode.cle ?? '30', du: vue?.periode.du ?? '', au: vue?.periode.au ?? '' },
        }
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
    ((ventes.etat === 'jamais' ||
      ((ventes.etat === 'ok' || ventes.etat === 'erreur' || ventes.etat === 'portee') &&
        (ventes.synchroAt === null || +maintenant - +ventes.synchroAt >= FRAICHEUR_MS))) ||
      // Les visites se relisent au même rythme que les ventes.
      (vue !== null &&
        (vue.visites.etat === 'jamais' ||
          ((vue.visites.etat === 'ok' || vue.visites.etat === 'erreur') &&
            (vue.visites.synchroAt === null || +maintenant - +vue.visites.synchroAt >= FRAICHEUR_MS)))))

  return (
    <CadreNova contexte={{ ...contexte, siteId }} courant="tableau" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : vue.vierge ? (
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
            {ventes === undefined || ((ventes.etat === 'absent' || ventes.etat === 'offre') && vue.visites.etat === 'absent') ? null : (
              <SynchroNova
                derniere={(() => {
                  const quand = ventes.synchroAt ?? vue.visites.synchroAt
                  return quand === null ? null : quandLisible(quand)
                })()}
                aRelire={lireVentes}
                probleme={
                  ventes.etat === 'portee' || ventes.etat === 'erreur'
                    ? ventes.message
                    : vue.visites.etat === 'erreur'
                      ? `Google Analytics : ${vue.visites.message}`
                      : null
                }
              />
            )}
            {vue.sansComparaison === null ? null : (
              <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">{vue.sansComparaison}</p>
            )}
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">
              Sources : {vue.sources.length === 0 ? 'aucune' : vue.sources.join(' + ')}
              {siteAnalyse === undefined ? '' : ` · site ${siteAnalyse.host}`}
            </p>
          </div>

          <IndicateursNova kpis={vue.kpis} devise={vue.devise} ordre={vue.ordre} />
          <AVenirNova texte={vue.aVenir} />
          <AlertesNova alertes={vue.alertes} locale={locale} siteId={siteId} transmission={transmission} />
          <InsightsNova insights={vue.insights} />
          {vue.objectifs.length === 0 ? null : (
            <ObjectifsNova suivis={vue.objectifs} devise={vue.devise} versReglages={`${base}/pilotage${suffixe === '' ? '' : `?${suffixe}`}`} />
          )}
          <CanauxNova canaux={vue.canaux} devise={vue.devise} />
          {vue.visitesPeriode === null ? null : <VisitesNova visites={vue.visitesPeriode} devise={vue.devise} />}
          <AttributionNova attribution={vue.attribution} devise={vue.devise} manqueVentes={vue.manqueVentes} />
          <OpportunitesNova opportunites={vue.opportunites} transmission={transmission} />
          <CampagnesNova campagnes={vue.campagnes} devise={vue.devise} filtre={filtre} lien={lienRegie} />
          <ProduitsNova produits={vue.produits} devise={vue.devise} />
          <SanteNova global={vue.sante.global} lignes={vue.sante.lignes} />
          {vue.visites.etat === 'absent' ? null : <ProprieteGa4 actuelle={vue.visites.propriete} />}
          <PourOriaNova rapport={vue.pourOria} versOria={`/${locale}/oria${suffixe === '' ? '' : `?${suffixe}`}`} />
          <ParlerANova versConversation={versConversation} cout={VISIBILITY_ASK_ESTIMATED_CREDITS} />
        </>
      )}
    </CadreNova>
  )
}
