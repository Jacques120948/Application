import { lireLina } from '@/server/lina/service'
import { CommandesAttenteLina, ProduitsReachatLina, ReachatGlobalLina, SuggestionsLina, TopProduitsLina } from '@/components/studio/LinaV2'
import { VISIBILITY_ASK_ESTIMATED_CREDITS } from '@/server/agents/visibility-service'
import { ComportementsLina } from '@/components/studio/LinaV3'
import { CadreLina, ouvrirLina } from '../cadre'

/** Ce que les produits disent du réachat : quoi, quand, et ce qu'on achète ensuite. */
export default async function ProduitsLinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirLina(params, demande.siteId)
  const { locale, user, siteId, ouvert } = contexte
  const vue = ouvert ? await lireLina(user.id, { avecNova: false }) : null
  const versTableau = `/${locale}/lina${siteId === '' ? '' : `?siteId=${siteId}`}`
  return (
    <CadreLina contexte={contexte} courant="produits" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : vue.analyse === null ? (
        <CommandesAttenteLina enCours={vue.etat.commandesEnCours} message={vue.etat.commandesMessage} />
      ) : (
        <>
          <ReachatGlobalLina analyse={vue.analyse} />
          <ProduitsReachatLina reachat={vue.reachat} versTableau={versTableau} />
          <SuggestionsLina
            titre="Produits complémentaires"
            sousTitre="Ce que les clients achètent ensuite, dans une commande plus tardive. Observé ; une corrélation, pas une règle."
            liste={vue.croisees}
            prefixe="cross-sell"
            versTableau={versTableau}
          />
          <SuggestionsLina
            titre="Opportunités de montée en gamme"
            sousTitre="Même type de produit, prix moyen au moins 30 % plus élevé, acheté ensuite par les mêmes clients."
            liste={vue.montees}
            prefixe="upsell"
            versTableau={versTableau}
          />
          {vue.reachat.length + vue.croisees.length + vue.montees.length === 0 ? null : (
            <ComportementsLina
              transmission={
                siteId === ''
                  ? undefined
                  : { siteId, locale, cout: VISIBILITY_ASK_ESTIMATED_CREDITS, versConversation: `/${locale}/visibilite/equipe?siteId=${siteId}&agent=` }
              }
            />
          )}
          <TopProduitsLina produits={vue.produits} devise={vue.devise} />
        </>
      )}
    </CadreLina>
  )
}
