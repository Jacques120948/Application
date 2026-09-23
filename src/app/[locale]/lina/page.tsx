import { VISIBILITY_ASK_ESTIMATED_CREDITS } from '@/server/agents/visibility-service'
import { FRAICHEUR_MS } from '@/server/nova/collecte'
import { lireLina } from '@/server/lina/service'
import { lireAutonomie } from '@/server/lina/assiste'
import { quandLisible } from '@/server/nova/service'
import { SynchroLina } from '@/components/studio/SynchroLina'
import {
  AccueilLina,
  CampagnesLina,
  IndicateursLina,
  InsightsLina,
  NovaLina,
  PaniersLina,
  ParlerALina,
  PourOriaLina,
  QuickWinsLina,
  ReactivationLina,
  SanteLina,
} from '@/components/studio/Lina'
import { ActionsLina, AlertesLina, PistesServicesLina } from '@/components/studio/LinaV3'
import { NOM_SOURCE_LINA } from '@/server/lina/sources'
import { CadreLina, ouvrirLina } from './cadre'

/**
 * L'espace de Lina : les clients déjà acquis, et ce qu'on peut en faire.
 *
 * L'écran répond dans l'ordre aux questions qu'on se pose en l'ouvrant : combien de clients
 * reviennent, qui relancer, que perd-on en paniers, quelle campagne lancer maintenant.
 *
 * **Rien ici ne coûte un crédit.** Les segments sont calculés par du code sur l'index relu
 * en base ; la boutique n'est relue que si l'index a plus de douze heures. Seules la
 * conversation et les transmissions à Milo ou à Cleo appellent un modèle, sur un clic.
 */
export const maxDuration = 60

export default async function LinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirLina(params, demande.siteId)
  const { locale, user, siteId, ouvert } = contexte
  const [vue, autonomie] = ouvert ? await Promise.all([lireLina(user.id), lireAutonomie(user.id)]) : [null, 'conseil' as const]
  const assiste = autonomie === 'assiste' && vue?.etat.source === 'shopify'
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  const versConversation = siteId === '' ? null : `/${locale}/visibilite/equipe${suffixe}&agent=lina`
  const transmission =
    siteId === ''
      ? undefined
      : { siteId, locale, cout: VISIBILITY_ASK_ESTIMATED_CREDITS, versConversation: `/${locale}/visibilite/equipe${suffixe}&agent=` }
  const maintenant = new Date()

  const etat = vue?.etat
  const lisible = etat !== undefined && etat.etat !== 'absent' && etat.etat !== 'offre'
  const aRelire =
    etat !== undefined &&
    lisible &&
    etat.etat !== 'en-cours' &&
    etat.synchroAt !== null &&
    +maintenant - +etat.synchroAt >= FRAICHEUR_MS
  const synchro =
    etat === undefined || !lisible ? null : (
      <div id="analyse" className="scroll-mt-6">
        <SynchroLina
          derniere={etat.synchroAt === null ? null : quandLisible(etat.synchroAt)}
          enCours={etat.etat === 'en-cours' || etat.commandesEnCours}
          aRelire={aRelire}
          // Sur l'accueil, le problème est déjà dit en toutes lettres : pas deux fois.
          probleme={vue?.vierge !== true && (etat.etat === 'erreur' || etat.etat === 'portee' || etat.etat === 'protegees') ? etat.message : null}
          nomSource={etat.source === null ? 'Shopify' : NOM_SOURCE_LINA[etat.source]}
        />
      </div>
    )

  return (
    <CadreLina contexte={contexte} courant="tableau" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : vue.vierge || vue.indicateurs === null ? (
        <>
          <AccueilLina etat={vue.etat} activite={vue.activite} versConnexions={`/${locale}/connexions`}>
            {synchro}
          </AccueilLina>
          <PistesServicesLina pistes={vue.pistesServices} activite={vue.activite} />
        </>
      ) : (
        <>
          <div className="grid gap-2">
            {synchro}
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">
              {vue.etat.source === 'woocommerce'
                ? `Source : commandes WooCommerce des trois dernières années (${vue.etat.clients} clients${vue.etat.tronque ? ', lecture partielle' : ''}). Aucun nom ni adresse n’est lu ; le courriel d’un achat sans compte est transformé en empreinte et jamais gardé.`
                : vue.etat.source === 'stripe'
                  ? `Source : paiements Stripe des trois dernières années (${vue.etat.clients} clients${vue.etat.tronque ? ', lecture partielle' : ''}). Aucun nom, courriel ni adresse n’est lu.`
                  : `Source : base clients Shopify (${vue.etat.clients} fiches${vue.etat.tronque ? ', lecture partielle' : ''}) et paniers abandonnés. Aucun nom, courriel ni adresse n’est lu.`}
            </p>
          </div>
          <IndicateursLina
            indicateurs={vue.indicateurs}
            paniers={vue.paniers}
            devise={vue.devise}
            topSegment={vue.topSegment}
            opportunites={vue.campagnes.length}
          />
          <ActionsLina
            campagnes={vue.campagnes.map((campagne) => campagne.cle)}
            versCampagne={(cle) => `#campagne-${cle}`}
            versSegment={(cle) => `/${locale}/lina/segments?${siteId === '' ? '' : `siteId=${siteId}&`}segment=${cle}#membres`}
            versConversation={versConversation}
          />
          <AlertesLina
            alertes={vue.alertes}
            versOnglet={(onglet) => `/${locale}/lina${onglet === 'tableau' ? '/bilan' : `/${onglet}`}${suffixe}`}
          />
          <InsightsLina insights={vue.insights} />
          <QuickWinsLina quickWins={vue.quickWins} />
          <ReactivationLina segments={vue.segments} devise={vue.devise} campagnes={vue.campagnes} produits={vue.produitsSegments} />
          <PaniersLina paniers={vue.paniers} devise={vue.devise} transmission={transmission} />
          <CampagnesLina campagnes={vue.campagnes} devise={vue.devise} transmission={transmission} assiste={assiste} />
          <PistesServicesLina pistes={vue.pistesServices} activite={vue.activite} />
          <NovaLina nova={vue.nova} indicateurs={vue.indicateurs} devise={vue.devise} />
          <SanteLina lignes={vue.sante} />
          <PourOriaLina lignes={vue.pourOria} versOria={`/${locale}/oria${suffixe}`} />
          <ParlerALina versConversation={versConversation} cout={VISIBILITY_ASK_ESTIMATED_CREDITS} />
        </>
      )}
    </CadreLina>
  )
}
