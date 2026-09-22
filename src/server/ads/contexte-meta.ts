import { compteActif } from './comptes'
import { metaAds } from './meta-ads'
import { evaluerMeta } from './regles-meta'
import { lireTableauMeta, type LigneMeta } from './tableau-meta'
import type { ProfilAds } from './profil'

/**
 * Ce que MIRA a le droit de lire, et sous quelle forme.
 *
 * Tout ce qui suit est déjà calculé. MIRA ne reçoit ni micros, ni lignes de relevé, ni la
 * moindre division à faire : elle reçoit des résultats et les met en phrases. La raison tient
 * en une ligne — une erreur d'arithmétique sur un ROAS ne se voit pas, elle ressemble à un
 * chiffre, et elle se paie en budget mal placé le lendemain.
 *
 * Elle reçoit aussi les constats du moteur de règles, tels qu'ils ont été écrits. Elle les
 * explique ; elle ne les produit pas et ne les complète pas. C'est le partage de travail de
 * tout ce module : la détection est une condition qu'on peut lire, l'explication est une
 * phrase qu'on peut comprendre, et confier la première à un modèle reviendrait à faire
 * décider d'une dépense réelle par quelque chose qui ne dit jamais deux fois la même chose.
 *
 * Deux choses lui sont dites que Naya n'a pas à savoir.
 *
 * **La fenêtre d'attribution est celle du compte.** Les chiffres qu'elle cite sont ceux que
 * la personne lit dans son gestionnaire Meta. Sans cette précision, MIRA pourrait présenter
 * une valeur attribuée comme un encaissement constaté.
 *
 * **La fréquence est un plancher.** La portée d'une période n'est pas la somme des portées
 * quotidiennes, et Meta ne rend pas la portée dédoublonnée d'une période arbitraire. Lui
 * cacher cette limite la ferait affirmer une répétition au dixième près.
 */

/** La fenêtre donnée à MIRA. Sept jours : assez pour une tendance, assez court pour agir. */
const FENETRE = 7

/** Au-delà, la liste coûte plus de contexte qu'elle n'apporte de matière. */
const LIGNES_MAX = 8

/** Au-delà, les constats se répètent et noient les premiers. */
const CONSTATS_MAX = 8

function argent(valeur: number | null, devise: string): string {
  return valeur === null ? 'non calculable' : `${valeur.toLocaleString('fr-CH')} ${devise}`
}

function pourcent(valeur: number | null): string {
  return valeur === null ? 'non calculable' : `${valeur} %`
}

function lignesObjectifs(profil: ProfilAds, devise: string): string[] {
  const dits: string[] = []
  if (profil.roasCible > 0) dits.push(`ROAS visé : ${profil.roasCible} %`)
  if (profil.cpaCible > 0) dits.push(`coût par vente acceptable : ${argent(profil.cpaCible, devise)}`)
  if (profil.margePourcent > 0) dits.push(`marge brute : ${profil.margePourcent} %`)
  if (profil.panierMoyen > 0) dits.push(`panier moyen : ${argent(profil.panierMoyen, devise)}`)
  if (profil.budgetMensuel > 0)
    dits.push(`budget mensuel : ${argent(profil.budgetMensuel, devise)}`)

  if (dits.length === 0) {
    /*
     * L'absence est écrite, et la consigne qui l'accompagne aussi. Un modèle à qui l'on ne
     * dit rien suppose, et une supposition de marge se paie immédiatement : « votre ROAS de
     * 250 % est bon » est faux pour qui travaille à 20 % de marge.
     */
    return [
      'OBJECTIFS : aucun n’est renseigné. Tu ne peux donc pas dire si ces chiffres sont bons' +
        ' ou mauvais. Demande la marge et le coût par vente acceptable, explique en une phrase' +
        ' pourquoi ils changent tout, et ne suppose jamais une moyenne de marché.',
    ]
  }
  return [`OBJECTIFS posés par la personne : ${dits.join(', ')}.`]
}

function lignesNiveau(titre: string, lignes: readonly LigneMeta[], devise: string): string[] {
  if (lignes.length === 0) return [`${titre} : aucun sur cette période.`]

  const montrees = lignes.slice(0, LIGNES_MAX)
  const dits = [
    `${titre} (nom, statut, budget quotidien, dépense, ROAS, coût par vente, taux de clic,` +
      ' fréquence) :',
  ]
  for (const ligne of montrees) {
    dits.push(
      `- ${ligne.nom} · ${ligne.statut} ·` +
        ` ${ligne.budget === 0 ? 'budget porté ailleurs' : `${argent(ligne.budget, devise)}/jour`} :` +
        ` ${argent(ligne.actuel.cout, devise)}, ${pourcent(ligne.actuel.roas)},` +
        ` ${argent(ligne.actuel.cpa, devise)}, ${pourcent(ligne.actuel.ctr)},` +
        ` ${ligne.actuel.frequence === 0 ? 'fréquence inconnue' : `fréquence ${ligne.actuel.frequence}`}`,
    )
  }
  if (lignes.length > montrees.length) {
    dits.push(`(${lignes.length - montrees.length} autres non listés ici.)`)
  }
  return dits
}

/** Le contexte Meta, ou `null` quand il n'y a pas de compte suivi. */
export async function contexteMeta(userId: string): Promise<string | null> {
  const compte = await compteActif(userId, metaAds.id)
  if (compte === null) return null

  const vue = await lireTableauMeta(userId, FENETRE).catch(() => null)
  if (vue === null) {
    return (
      `DONNÉES META (compte suivi : ${compte.nom}) : aucune lecture n’a encore eu lieu. Tu ne` +
      ' disposes d’aucune dépense, d’aucun ROAS et d’aucune vente. Ne cite aucun chiffre' +
      ' publicitaire, et invite à lancer la lecture des campagnes.'
    )
  }

  const devise = compte.devise
  const total = vue.total
  const lignes: string[] = [
    'DONNÉES META ADS (lues par Evoliia et déjà calculées — tu n’as aucun calcul à faire) :',
    `Compte suivi : ${compte.nom} (${compte.compteId}), devise ${devise}, fuseau ${compte.fuseau}.`,
    ...lignesObjectifs(vue.profil, devise),
    `PÉRIODE : ${FENETRE} derniers jours, la journée en cours exclue car incomplète.`,
    `Dépense : ${argent(total.cout, devise)}. Chiffre d’affaires attribué par Meta :` +
      ` ${argent(total.valeur, devise)}. Ventes : ${total.conversions}.`,
    `ROAS : ${pourcent(total.roas)}. Coût par vente : ${argent(total.cpa, devise)}.` +
      ` Taux de clic : ${pourcent(total.ctr)}. Coût par clic : ${argent(total.cpc, devise)}.` +
      ` Coût des mille affichages : ${argent(total.cpm, devise)}.`,
    `Affichages : ${total.impressions}. Clics : ${total.clics}. Portée :` +
      ` ${total.portee === 0 ? 'non rendue par Meta' : total.portee}. Fréquence :` +
      ` ${total.frequence === 0 ? 'non calculable' : total.frequence}.`,
    /*
     * Deux limites dites, parce qu'un modèle qui les ignore affirme plus que la donnée ne
     * permet — et que c'est précisément là que la confiance se perd.
     */
    'ATTRIBUTION : ces chiffres suivent la fenêtre d’attribution du compte Meta, celle-là' +
      ' même que montre le gestionnaire de publicités. Une valeur attribuée n’est pas un' +
      ' encaissement constaté : ne la présente jamais comme tel.',
    'FRÉQUENCE : c’est un plancher. La portée d’une période n’est pas la somme des portées' +
      ' quotidiennes, et Meta ne rend pas la portée dédoublonnée d’une période arbitraire. La' +
      ' répétition réelle est donc au moins celle-là, jamais moins.',
    ...lignesNiveau('CAMPAGNES', vue.campagnes, devise),
    ...lignesNiveau('ENSEMBLES DE PUBLICITÉS', vue.ensembles, devise),
    ...lignesNiveau('ANNONCES', vue.annonces, devise),
  ]

  /*
   * Les constats, tels que les règles les ont écrits. MIRA les explique et les met en
   * phrases ; elle n'en invente pas d'autres, et la consigne le dit en toutes lettres — un
   * modèle à qui l'on montre une liste de diagnostics en ajoute volontiers un neuvième, qui
   * aura l'air des huit premiers sans reposer sur quoi que ce soit.
   */
  const constats = evaluerMeta({ devise, profil: vue.profil, vue }).slice(0, CONSTATS_MAX)
  if (constats.length === 0) {
    lignes.push(
      'CONSTATS D’EVOLIIA : aucun. Aucune règle ne s’est déclenchée sur cette période. Ne' +
        ' fabrique pas de problème pour avoir quelque chose à dire.',
    )
  } else {
    lignes.push(
      'CONSTATS D’EVOLIIA (produits par des règles écrites, pas par un modèle — tu les' +
        ' expliques, tu n’en ajoutes aucun) :',
    )
    for (const constat of constats) {
      lignes.push(
        `- [${constat.priorite}] ${constat.niveau} « ${constat.cible} » : ${constat.observation}` +
          ` Proposition d’Evoliia : ${constat.recommandation}`,
      )
    }
  }

  return lignes.join('\n')
}

/** Exporté pour les tests : le contexte doit rester lisible et borné. */
export const BORNES_CONTEXTE_META = { FENETRE, LIGNES_MAX, CONSTATS_MAX }

