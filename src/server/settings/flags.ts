import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'

/**
 * Interrupteurs d'exploitation.
 *
 * Certaines fonctions dépendent d'une autorisation extérieure qui arrive à sa date, pas à
 * la nôtre. Les coder en dur obligerait à un déploiement le jour où elle tombe, et à un
 * autre le jour où elle est retirée. Elles se règlent donc depuis le back-office.
 *
 * À ne pas confondre avec les droits par abonnement, qui disent ce qu'une offre ouvre. Un
 * interrupteur dit si la fonction existe du tout sur cette installation. Une fonction
 * éteinte reste éteinte pour tout le monde, quelle que soit l'offre.
 */

export const FLAGS = {
  /**
   * Envoi de publications vers l'espace Postelya d'un créateur.
   *
   * Éteint tant que Postelya n'a pas obtenu l'accord de Meta : sans lui, un créateur
   * pourrait relier son espace et y déposer des semaines entières sans jamais pouvoir les
   * publier. Mieux vaut une fonction annoncée comme à venir qu'une fonction qui déçoit.
   */
  socialPublishing: {
    key: 'flag.social.publishing',
    label: 'Envoi vers Postelya',
    help: "Relier un espace Postelya et y déposer les semaines préparées. À n'activer qu'une fois Postelya autorisé par Meta à publier sur les comptes de vos créateurs.",
    /** Par défaut éteint : une fonction s'allume quand elle marche, pas avant. */
    fallback: false,
  },
  /*
   * Les deux modules et leurs secondes versions. Les V1 sont ouvertes : elles sont
   * construites, testées, et bornées par les quotas des offres. Les V2 restent fermées tant
   * que leurs sources extérieures et leurs analyses périodiques ne sont pas branchées.
   * Chacun se coupe d'un clic sans retirer une ligne de code.
   */
  /**
   * La surveillance hebdomadaire des sites suivis.
   *
   * Éteinte par défaut, et pas seulement par prudence de principe : c'est la seule fonction
   * du produit qui consomme du réseau à la charge d'Evoliia sans qu'une personne l'ait
   * demandé à cet instant. Bornée — six requêtes par site et par semaine — mais l'allumer
   * reste une décision d'exploitant, pas un réglage par défaut.
   */
  surveillance: {
    key: 'flag.surveillance',
    label: 'Surveillance hebdomadaire',
    help: "Contrôle chaque semaine que les sites suivis répondent toujours et n'ont pas cessé d'être indexables. Six requêtes par site, aucun crédit consommé. Demande un planificateur qui appelle la route prévue.",
    fallback: false,
  },
  /**
   * La tournée quotidienne : indexation, relevé des chiffres, rédaction du calendrier.
   *
   * Éteinte par défaut, et c'est le verrou d'exploitant sur la seule fonction du produit
   * qui puisse dépenser des crédits sans qu'une personne clique. Chaque site a en plus ses
   * propres réglages, tous à « non » au départ : ce drapeau n'allume rien, il autorise.
   * L'éteindre arrête tout, pour tout le monde, sans déployer.
   */
  automatisation: {
    key: 'flag.automatisation',
    label: 'Tournée quotidienne',
    help: "Autorise ce que chaque personne a allumé site par site : vérification d'indexation, relevé des chiffres de recherche, et rédaction au rythme du calendrier. La rédaction débite les crédits de la personne, au même tarif qu'un clic. Demande un planificateur qui appelle la route prévue.",
    fallback: false,
  },
  radar: {
    key: 'flag.radar',
    label: 'Radar d’opportunités',
    help: 'Le module Radar, pour les offres qui l’ouvrent. Fermer ici le ferme pour tout le monde.',
    fallback: true,
  },
  radarV2: {
    key: 'flag.radar.v2',
    label: 'Radar — veille périodique et signaux extérieurs',
    help: 'Recherches hebdomadaires, signaux extérieurs, apprentissage des préférences. À ouvrir une fois une source branchée.',
    fallback: false,
  },
  liaSupport: {
    key: 'flag.lia',
    label: 'Lia — Support client',
    help: 'L’assistante de support dans les applications créées, pour les offres qui l’ouvrent.',
    fallback: true,
  },
  liaV2: {
    key: 'flag.lia.v2',
    label: 'Lia — analyse des conversations',
    help: 'Questions fréquentes, fonctions demandées, bugs possibles, tirés des conversations par lot.',
    fallback: false,
  },
  /**
   * L'agent qui modifie une application en plusieurs étapes.
   *
   * Éteint par défaut, et à côté de l'existant plutôt qu'à sa place : la modification à
   * coup unique continue de fonctionner, et reste le chemin emprunté tant que
   * l'interrupteur n'est pas ouvert. Une fonction s'allume quand elle fait mieux que ce
   * qu'elle remplace, mesuré sur des cas réels, pas avant.
   */
  appBuilder: {
    key: 'flag.agent.builder',
    label: 'Agent de construction',
    help: "Modifier une application en plusieurs étapes : l'agent lit les pages concernées avant de décider, corrige ses propres erreurs, et s'arrête sur des bornes d'étapes, de jetons et de crédits. Fermé, la modification assistée classique reste en place.",
    fallback: false,
  },
} as const

export type FlagName = keyof typeof FLAGS

export async function isEnabled(name: FlagName): Promise<boolean> {
  const flag = FLAGS[name]
  const row = await prisma.siteSetting
    .findUnique({ where: { key: flag.key }, select: { value: true } })
    .catch(() => null)
  if (row === null) return flag.fallback
  return row.value === 'on'
}

/** État de tous les interrupteurs, pour l'écran d'administration. */
export async function readFlags(): Promise<Record<FlagName, boolean>> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.values(FLAGS).map((flag) => flag.key) } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const names = Object.keys(FLAGS) as FlagName[]
  return Object.fromEntries(
    names.map((name) => [name, (byKey.get(FLAGS[name].key) ?? null) === null
      ? FLAGS[name].fallback
      : byKey.get(FLAGS[name].key) === 'on']),
  ) as Record<FlagName, boolean>
}

export async function setFlag(name: FlagName, enabled: boolean): Promise<void> {
  const flag = FLAGS[name]
  await prisma.siteSetting.upsert({
    where: { key: flag.key },
    update: { value: enabled ? 'on' : 'off' },
    create: { key: flag.key, value: enabled ? 'on' : 'off' },
  })
  logger.info('interrupteur modifié', { flag: flag.key, enabled })
}
