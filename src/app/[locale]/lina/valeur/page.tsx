import { VISIBILITY_ASK_ESTIMATED_CREDITS } from '@/server/agents/visibility-service'
import { lireLina } from '@/server/lina/service'
import { CohortesClientsNova } from '@/components/studio/Nova'
import { AudiencesLina, CommandesAttenteLina, FideliteLina, RisquesLina, ScenariosLina, ValeurLina } from '@/components/studio/LinaV2'
import { CadreLina, ouvrirLina } from '../cadre'

/** Combien vaut un client, qui risque de partir, et ce qu'on peut préparer pour les garder. */
export default async function ValeurLinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirLina(params, demande.siteId)
  const { locale, user, siteId, ouvert } = contexte
  const vue = ouvert ? await lireLina(user.id) : null
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  const transmission =
    siteId === ''
      ? undefined
      : { siteId, locale, cout: VISIBILITY_ASK_ESTIMATED_CREDITS, versConversation: `/${locale}/visibilite/equipe${suffixe}&agent=` }
  return (
    <CadreLina contexte={contexte} courant="valeur" onglets={vue !== null && !vue.vierge}>
      {vue === null || vue.vierge ? null : (
        <>
          {vue.valeur === null ? null : <ValeurLina valeur={vue.valeur} devise={vue.devise} cac={vue.nova?.cac ?? null} />}
          <RisquesLina
            risques={vue.risques}
            devise={vue.devise}
            versSegment={`/${locale}/lina/segments?${siteId === '' ? '' : `siteId=${siteId}&`}segment=a-risque#membres`}
          />
          {vue.analyse === null ? (
            <CommandesAttenteLina enCours={vue.etat.commandesEnCours} message={vue.etat.commandesMessage} />
          ) : (
            <CohortesClientsNova
              cohortes={vue.analyse.cohortes}
              source="shopify"
              devise={vue.devise}
              fenetre={`sur les douze dernières cohortes, commandes lues depuis le ${vue.analyse.depuis.split('-').reverse().join('.')}`}
            />
          )}
          <FideliteLina paliers={vue.fidelite} devise={vue.devise} />
          <AudiencesLina audiences={vue.audiences} transmission={transmission} />
          <ScenariosLina scenarios={vue.scenarios} />
        </>
      )}
    </CadreLina>
  )
}
