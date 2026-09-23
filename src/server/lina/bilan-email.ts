import { env } from '@/lib/env'
import { semaineLisible } from '@/lib/lina'
import { prisma } from '@/server/db/client'
import { getEntitlements } from '@/server/billing/entitlements'
import { isEmailAvailable, sendEmails, type Email } from '@/server/email/send'
import { logger } from '@/server/observability/logger'
import { isEnabled } from '@/server/settings/flags'
import { lundiDe } from './releves'
import { lireLina, type VueLina } from './service'

/**
 * Le bilan de la semaine de Lina, par e-mail, le lundi.
 *
 * Un coût pour Evoliia (Resend facture au-delà de son quota), décidé et borné par trois
 * verrous : l'interrupteur `linaBilanEmail` du back-office, le choix de la personne (éteint
 * par défaut), et une fois par semaine au plus. Les envois partent par lots de cent.
 *
 * Le contenu est celui de l'écran « Bilan » : des totaux et des évolutions, jamais un client,
 * jamais un nom. Aucun modèle n'est appelé.
 */

/** Au-delà, la tournée s'arrête et reprendra demain : une fonction a cinq minutes. */
const DUREE_MAX_MS = 240_000
const PERSONNES_PAR_TOURNEE = 1_000

export async function lireBilanEmail(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { linaBilanEmail: true } })
  return user?.linaBilanEmail ?? false
}

export async function reglerBilanEmail(userId: string, actif: boolean): Promise<boolean> {
  await prisma.user.update({ where: { id: userId }, data: { linaBilanEmail: actif } })
  return actif
}

/** Le texte de l'e-mail. Pur : des totaux, des phrases déjà écrites par le bilan. */
export function texteBilanEmail(vue: VueLina, prenom: string | null, base: string, locale: string): Omit<Email, 'to'> | null {
  const bilan = vue.bilan
  if (vue.vierge || bilan === null) return null
  const lien = `${base}/${locale}/lina/bilan`
  const lignes = [
    `Bonjour${prenom ? ` ${prenom}` : ''},`,
    '',
    `Voici le bilan de vos clients pour la semaine du ${semaineLisible(bilan.semaine)}${bilan.compareA === null ? ' (premier relevé : les comparaisons commencent la semaine prochaine)' : `, comparé à la semaine du ${semaineLisible(bilan.compareA)}`}.`,
    '',
    ...bilan.lignes.map((ligne) => `— ${ligne.libelle} : ${ligne.valeur}${ligne.evolution === null ? '' : ` (${ligne.evolution})`}`),
  ]
  if (vue.alertes.length > 0) lignes.push('', 'À regarder :', ...vue.alertes.map((alerte) => `— ${alerte.titre}. ${alerte.texte}`))
  if (bilan.aFaire.length > 0) lignes.push('', 'À faire cette semaine :', ...bilan.aFaire.map((action, rang) => `${rang + 1}. ${action}`))
  if (bilan.opportunite !== null) lignes.push('', `Opportunité principale : ${bilan.opportunite}`)
  lignes.push(
    '',
    'Les évolutions sont observées d’une semaine à l’autre, pas expliquées. Le score de fidélité est un indicateur interne d’Evoliia.',
    '',
    `Voir le bilan complet : ${lien}`,
    '',
    `Pour ne plus recevoir ce bilan, décochez « Recevoir le bilan par e-mail » sur cette même page.`,
    '— Lina, CRM & Fidélisation, Evoliia',
  )
  const alerte = vue.alertes.find((un) => un.niveau === 'attention')
  return {
    subject: `Lina — votre bilan de la semaine${alerte === undefined ? '' : ` : ${alerte.titre.toLowerCase()}`}`,
    text: lignes.join('\n'),
  }
}

export type TourneeBilans = { examines: number; envoyes: number; ignores: number; raison?: string }

/**
 * La tournée : les personnes qui ont demandé le bilan et ne l'ont pas encore reçu cette
 * semaine. Appelée par la tournée quotidienne ; celles qu'une tournée n'a pas eu le temps
 * de servir le sont le lendemain, jamais deux fois la même semaine.
 */
export async function envoyerBilansLina(maintenant = new Date()): Promise<TourneeBilans> {
  const tournee: TourneeBilans = { examines: 0, envoyes: 0, ignores: 0 }
  if (!(await isEnabled('linaBilanEmail'))) return { ...tournee, raison: 'interrupteur éteint' }
  if (!isEmailAvailable()) return { ...tournee, raison: 'aucun fournisseur d’e-mail' }
  const semaine = new Date(`${lundiDe(maintenant)}T00:00:00Z`)
  const debut = Date.now()
  const candidats = await prisma.user.findMany({
    where: { linaBilanEmail: true, disabledAt: null, OR: [{ linaBilanEnvoyeLe: null }, { linaBilanEnvoyeLe: { lt: semaine } }] },
    select: { id: true, email: true, name: true, locale: true },
    orderBy: { createdAt: 'asc' },
    take: PERSONNES_PAR_TOURNEE,
  })
  const base = env.appUrl.replace(/\/$/u, '')
  const prets: { id: string; email: Email }[] = []
  const servis: string[] = []
  for (const user of candidats) {
    if (Date.now() - debut > DUREE_MAX_MS) break
    tournee.examines += 1
    try {
      const droits = await getEntitlements(user.id)
      const vue = droits.granted.includes('lina_agent') ? await lireLina(user.id, { avecNova: false, maintenant }) : null
      const contenu = vue === null ? null : texteBilanEmail(vue, user.name?.split(' ')[0] ?? null, base, user.locale || 'fr')
      if (contenu === null) {
        // Rien à dire cette semaine (base pas encore lue, Lina hors de l'offre) : pas d'e-mail.
        tournee.ignores += 1
        servis.push(user.id)
        continue
      }
      prets.push({ id: user.id, email: { ...contenu, to: user.email } })
    } catch {
      tournee.ignores += 1
      logger.warn('bilan de Lina : personne ignorée', { userId: user.id })
    }
  }
  if (prets.length > 0) {
    tournee.envoyes = await sendEmails(prets.map((un) => un.email))
    servis.push(...prets.map((un) => un.id))
  }
  if (servis.length > 0) await prisma.user.updateMany({ where: { id: { in: servis } }, data: { linaBilanEnvoyeLe: semaine } })
  logger.info('bilans de Lina envoyés', { examines: tournee.examines, envoyes: tournee.envoyes, ignores: tournee.ignores })
  return tournee
}
