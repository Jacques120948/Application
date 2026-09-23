/**
 * Le vocabulaire de Nova qui s'affiche : les canaux et leurs noms.
 *
 * Ici plutôt que côté serveur parce que l'écran en a besoin, et qu'un composant de
 * navigateur ne peut pas importer une valeur du serveur. Le classement lui-même — quelle
 * visite va dans quel canal — vit dans `server/nova/canaux.ts`.
 */

export const CANAUX = [
  'google-ads',
  'meta-ads',
  'seo',
  'ia',
  'social',
  'email',
  'direct',
  'referral',
  'autres',
  'inconnu',
] as const

export type CanalNova = (typeof CANAUX)[number]

export const NOM_CANAL: Record<CanalNova, string> = {
  'google-ads': 'Google Ads',
  'meta-ads': 'Meta Ads',
  seo: 'SEO',
  ia: 'Assistants IA',
  social: 'Réseaux sociaux',
  email: 'E-mail',
  direct: 'Direct',
  referral: 'Sites référents',
  autres: 'Autres',
  inconnu: 'Non attribué',
}

/** Les canaux payants : ceux dont on connaît la dépense. */
export const CANAUX_PAYANTS: readonly CanalNova[] = ['google-ads', 'meta-ads']

export const PERIODES = [
  { cle: 'aujourdhui', label: 'Aujourd’hui' },
  { cle: '7', label: '7 jours' },
  { cle: '30', label: '30 jours' },
  { cle: '90', label: '90 jours' },
] as const
