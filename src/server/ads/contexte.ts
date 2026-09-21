import { compteActif } from './comptes'
import { objectifsDuCompte, type LectureObjectifs, type ProfilAds } from './profil'
import { lireTableauAds, type Periode } from './tableau'

/**
 * Ce que Naya a le droit de lire, et sous quelle forme.
 *
 * Tout ce qui suit est déjà calculé. Naya ne reçoit ni micros, ni lignes de relevé, ni la
 * moindre division à faire : elle reçoit des résultats et les met en phrases. La raison
 * tient en une ligne — une erreur d'arithmétique sur un ROAS ne se voit pas, elle ressemble
 * à un chiffre, et elle se paie en budget mal placé le lendemain.
 *
 * Le verdict de rentabilité est le cœur de ce contexte. Sans la marge du commerçant, « ROAS
 * 245 % » ne veut rien dire et Naya ne pourrait qu'en faire la lecture à voix haute. Avec
 * elle, la même donnée devient « vous perdez cinq points sur chaque franc dépensé ». Quand
 * la marge n'est pas renseignée, c'est écrit en toutes lettres et la consigne est de le
 * demander — jamais de supposer une moyenne de marché.
 */

/** Au-delà, la liste coûte plus de contexte qu'elle n'apporte de matière. */
const CAMPAGNES_MAX = 12

/** La fenêtre donnée à Naya. Sept jours : assez pour une tendance, assez court pour agir. */
const FENETRE: Periode = 7

const OBJECTIFS_DITS: Record<ProfilAds['objectif'], string> = {
  conversions: 'obtenir le plus de ventes possible',
  valeur: 'obtenir le plus gros chiffre d’affaires',
  roas: 'maximiser le retour sur chaque franc dépensé',
  cpa: 'payer le moins cher possible par vente',
}

const VERDICTS_DITS: Record<LectureObjectifs['verdict'], string> = {
  rentable: 'rentable',
  equilibre: 'exactement à l’équilibre',
  perte: 'à perte',
  inconnu: 'indéterminé',
}

function argent(valeur: number | null, devise: string): string {
  return valeur === null ? 'non calculable' : `${valeur.toFixed(2)} ${devise}`
}

function pourcent(valeur: number | null): string {
  return valeur === null ? 'non calculable' : `${valeur} %`
}

/** Ce que le profil dit des objectifs, ou ce qu'il n'en dit pas. */
function lignesProfil(profil: ProfilAds, lecture: LectureObjectifs, devise: string): string[] {
  const lignes: string[] = []

  if (lecture.seuil === null) {
    lignes.push(
      'MARGE : non renseignée. Tu ne peux donc pas dire si cette publicité est rentable, et' +
        ' tu ne dois pas le supposer : à 40 % de marge il faut un ROAS de 250 %, à 20 % il en' +
        ' faut 500. Si la question de la rentabilité se pose, demande sa marge et explique' +
        ' pourquoi elle change tout.',
    )
  } else {
    lignes.push(
      `Marge brute déclarée : ${profil.margePourcent} %. Seuil de rentabilité calculé :` +
        ` ${lecture.seuil} % de ROAS — en dessous, la publicité coûte plus qu'elle ne rapporte.`,
    )
  }

  if (profil.activite.trim() !== '') lignes.push(`Activité : ${profil.activite}.`)
  if (profil.pays.trim() !== '') lignes.push(`Zones de vente : ${profil.pays}.`)
  if (profil.produits.trim() !== '') lignes.push(`Ce qui est vendu : ${profil.produits}.`)
  if (profil.panierMoyen > 0) lignes.push(`Panier moyen : ${argent(profil.panierMoyen, devise)}.`)
  if (lecture.roasCible !== null) lignes.push(`ROAS visé : ${lecture.roasCible} %.`)
  if (lecture.cpaCible !== null) {
    lignes.push(`Coût par vente accepté : ${argent(lecture.cpaCible, devise)}.`)
  }
  lignes.push(`Ce que la personne cherche avant tout : ${OBJECTIFS_DITS[profil.objectif]}.`)

  return lignes
}

/**
 * Les données publicitaires du compte suivi, prêtes à être lues par Naya.
 *
 * `null` quand il n'y a pas de compte suivi : l'appelant écrit alors qu'il n'y a rien, ce
 * qui n'est pas la même chose qu'un compte relié dont tous les chiffres seraient à zéro.
 */
export async function contextePublicitaire(userId: string): Promise<string | null> {
  const compte = await compteActif(userId)
  if (compte === null) return null

  const tableau = await lireTableauAds(userId, FENETRE).catch(() => null)
  if (tableau === null) return null

  const devise = compte.devise
  const lignes: string[] = [
    'DONNÉES PUBLICITAIRES (Google Ads, lues par Evoliia et déjà calculées) :',
    `Compte suivi : ${compte.nom} (${compte.compteId}), devise ${devise}, fuseau` +
      ` ${compte.fuseau}.`,
  ]

  if (!tableau.synchronise) {
    lignes.push(
      'Aucune lecture n’a encore eu lieu : tu ne disposes d’aucune dépense, d’aucun ROAS et' +
        ' d’aucune conversion. Ne cite aucun chiffre publicitaire.',
    )
    return lignes.join('\n')
  }

  const { profil, lecture } = await objectifsDuCompte(userId, compte, tableau.total)
  lignes.push(...lignesProfil(profil, lecture, devise))

  const total = tableau.total
  lignes.push(
    `PÉRIODE : ${tableau.depuis} au ${tableau.jusqua} (${FENETRE} jours, la journée en cours` +
      ' exclue car incomplète).',
    `Dépense : ${argent(total.cout, devise)}. Valeur des conversions :` +
      ` ${argent(total.valeur, devise)}. Conversions : ${total.conversions}.`,
    `ROAS : ${pourcent(total.roas)}. Coût par conversion : ${argent(total.cpa, devise)}.` +
      ` CTR : ${pourcent(total.ctr)}. Coût par clic : ${argent(total.cpc, devise)}.` +
      ` Clics : ${total.clics}. Impressions : ${total.impressions}.`,
  )

  if (lecture.verdict === 'inconnu') {
    lignes.push('VERDICT : indéterminé, faute de marge renseignée ou de dépense sur la période.')
  } else {
    const ecart =
      lecture.ecartSeuil === null
        ? ''
        : lecture.ecartSeuil >= 0
          ? `, soit ${Math.abs(lecture.ecartSeuil)} points au-dessus du seuil`
          : `, soit ${Math.abs(lecture.ecartSeuil)} points en dessous du seuil`
    lignes.push(
      `VERDICT calculé par Evoliia : ${VERDICTS_DITS[lecture.verdict]}${ecart}. Marge dégagée` +
        ` sur la période, publicité déduite : ${argent(lecture.benefice, devise)} — hors` +
        ' retours, frais d’expédition et ventes que Google n’attribue pas.',
    )
  }

  if (lecture.budget !== null) {
    const rythme = lecture.budget
    lignes.push(
      `BUDGET DU MOIS : ${argent(rythme.depense, devise)} dépensés sur` +
        ` ${argent(rythme.budget, devise)} (${rythme.consomme} %), en ${rythme.joursEcoules}` +
        ` jours sur ${rythme.joursDuMois}.` +
        (rythme.projection === null
          ? ' Le mois vient de commencer : aucune projection possible.'
          : ` À ce rythme : ${argent(rythme.projection, devise)} d’ici la fin du mois.`),
    )
  }

  const campagnes = tableau.campagnes.slice(0, CAMPAGNES_MAX)
  if (campagnes.length === 0) {
    lignes.push('CAMPAGNES : aucune campagne lue sur ce compte.')
  } else {
    lignes.push('CAMPAGNES (nom, type, statut, budget quotidien, dépense, ROAS, coût par vente) :')
    for (const campagne of campagnes) {
      const bride = campagne.budgetLimite ? ' [limitée par son budget selon Google]' : ''
      lignes.push(
        `- ${campagne.nom} · ${campagne.type} · ${campagne.statut} ·` +
          ` ${argent(campagne.budget, devise)}/jour : ${argent(campagne.actuel.cout, devise)},` +
          ` ${pourcent(campagne.actuel.roas)}, ${argent(campagne.actuel.cpa, devise)}${bride}`,
      )
    }
    if (tableau.campagnes.length > campagnes.length) {
      lignes.push(
        `(${tableau.campagnes.length - campagnes.length} autres campagnes non listées ici.)`,
      )
    }
  }

  lignes.push(
    'Tous ces chiffres ont été calculés par Evoliia. Ne les recalcule pas, ne les complète' +
      ' pas, et ne cite aucun chiffre publicitaire qui ne figure pas ci-dessus.',
  )

  return lignes.join('\n')
}
