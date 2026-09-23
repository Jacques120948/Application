import { z } from 'zod'
import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'

/**
 * Les résultats des campagnes, et leur comparaison.
 *
 * En V2, la personne les saisit : Lina ne lit encore aucun outil d'emailing. Les chiffres
 * saisis restent les siens ; Lina en tire des taux, le revenu par destinataire, et ne déclare
 * un gagnant d'un test A/B que si l'écart ne peut pas raisonnablement venir du hasard.
 */

export const resultatSchema = z
  .object({
    nom: z.string().trim().min(1).max(120),
    type: z.string().trim().max(60).default('autre'),
    groupe: z.string().trim().max(60).default(''),
    variante: z.enum(['', 'A', 'B']).default(''),
    envoyeLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable().default(null),
    envoyes: z.number().int().min(1).max(10_000_000),
    ouvertures: z.number().int().min(0).nullable().default(null),
    clics: z.number().int().min(0).nullable().default(null),
    conversions: z.number().int().min(0),
    caCents: z.number().int().min(0).max(2_000_000_000),
    desinscriptions: z.number().int().min(0).nullable().default(null),
  })
  .strict()
  .refine((r) => [r.ouvertures, r.clics, r.conversions, r.desinscriptions].every((valeur) => valeur === null || valeur <= r.envoyes), {
    message: 'Un nombre d’ouvertures, de clics, de conversions ou de désinscriptions ne peut pas dépasser le nombre d’envois.',
    path: ['envoyes'],
  })
  .refine((r) => (r.variante === '') === (r.groupe === ''), {
    message: 'Une variante A ou B appartient à un test : donnez-lui un nom de test, et inversement.',
    path: ['groupe'],
  })

export type ResultatSaisi = z.infer<typeof resultatSchema>

export type ResultatVu = ResultatSaisi & {
  id: string
  tauxOuverture: number | null
  tauxClic: number | null
  tauxConversion: number
  revenuParDestinataireCents: number
  tauxDesinscription: number | null
}

export function enrichir(id: string, r: ResultatSaisi): ResultatVu {
  return {
    ...r,
    id,
    tauxOuverture: r.ouvertures === null ? null : r.ouvertures / r.envoyes,
    tauxClic: r.clics === null ? null : r.clics / r.envoyes,
    tauxConversion: r.conversions / r.envoyes,
    revenuParDestinataireCents: Math.round(r.caCents / r.envoyes),
    tauxDesinscription: r.desinscriptions === null ? null : r.desinscriptions / r.envoyes,
  }
}

// ── Test A/B ────────────────────────────────────────────────────────────────

/** En dessous, un test A/B ne se lit pas : trop peu d'envois ou d'actions. */
export const ENVOIS_MIN_AB = 100
export const EVENEMENTS_MIN_AB = 20

export type VerdictAB = {
  groupe: string
  a: ResultatVu
  b: ResultatVu
  /** Sur quoi le test est jugé : les conversions, à défaut les clics. */
  critere: 'conversions' | 'clics'
  gagnant: 'A' | 'B' | null
  /** Écart relatif de B par rapport à A sur le critère. */
  ecart: number | null
  explication: string
}

/**
 * Test de deux proportions, bilatéral, au seuil de 95 %. Pur et sans dépendance : la formule
 * est courte, et une bibliothèque de statistiques pour elle serait disproportionnée.
 */
export function significatif(succesA: number, totalA: number, succesB: number, totalB: number): { z: number; significatif: boolean } {
  const pa = succesA / totalA
  const pb = succesB / totalB
  const p = (succesA + succesB) / (totalA + totalB)
  const ecartType = Math.sqrt(p * (1 - p) * (1 / totalA + 1 / totalB))
  if (ecartType === 0) return { z: 0, significatif: false }
  const z = (pb - pa) / ecartType
  return { z, significatif: Math.abs(z) >= 1.96 }
}

export function verdictAB(groupe: string, a: ResultatVu, b: ResultatVu): VerdictAB {
  const critere: VerdictAB['critere'] =
    a.conversions + b.conversions >= EVENEMENTS_MIN_AB || a.clics === null || b.clics === null ? 'conversions' : 'clics'
  const succes = (r: ResultatVu) => (critere === 'conversions' ? r.conversions : (r.clics ?? 0))
  const base = { groupe, a, b, critere }
  if (a.envoyes < ENVOIS_MIN_AB || b.envoyes < ENVOIS_MIN_AB) {
    return { ...base, gagnant: null, ecart: null, explication: `Pas encore de gagnant : il faut au moins ${ENVOIS_MIN_AB} envois par variante.` }
  }
  if (succes(a) + succes(b) < EVENEMENTS_MIN_AB) {
    return { ...base, gagnant: null, ecart: null, explication: `Pas encore de gagnant : trop peu de ${critere} (${succes(a) + succes(b)}) pour trancher.` }
  }
  const ta = succes(a) / a.envoyes
  const tb = succes(b) / b.envoyes
  const ecart = ta === 0 ? null : tb / ta - 1
  const test = significatif(succes(a), a.envoyes, succes(b), b.envoyes)
  if (!test.significatif) {
    return { ...base, gagnant: null, ecart, explication: `Pas de gagnant : l’écart observé sur les ${critere} peut venir du hasard (moins de 95 % de confiance).` }
  }
  const gagnant = tb > ta ? 'B' : 'A'
  return {
    ...base,
    gagnant,
    ecart,
    explication: `La variante ${gagnant} gagne sur les ${critere}, avec 95 % de confiance au moins.${critere === 'clics' ? ' Les conversions sont encore trop peu nombreuses pour confirmer.' : ''}`,
  }
}

/** Les tests A/B : les groupes qui ont exactement une variante A et une variante B. */
export function testsAB(resultats: readonly ResultatVu[]): VerdictAB[] {
  const groupes = new Map<string, ResultatVu[]>()
  for (const resultat of resultats) {
    if (resultat.groupe === '') continue
    groupes.set(resultat.groupe, [...(groupes.get(resultat.groupe) ?? []), resultat])
  }
  const verdicts: VerdictAB[] = []
  for (const [groupe, liste] of groupes) {
    const a = liste.find((r) => r.variante === 'A')
    const b = liste.find((r) => r.variante === 'B')
    if (a !== undefined && b !== undefined) verdicts.push(verdictAB(groupe, a, b))
  }
  return verdicts
}

// ── Base ────────────────────────────────────────────────────────────────────

export async function lireResultats(userId: string): Promise<ResultatVu[]> {
  const lignes = await withUserScope(userId, (tx) => tx.linaResultat.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }))
  return lignes.map((ligne) =>
    enrichir(ligne.id, {
      nom: ligne.nom,
      type: ligne.type,
      groupe: ligne.groupe,
      variante: ligne.variante as ResultatSaisi['variante'],
      envoyeLe: ligne.envoyeLe === null ? null : ligne.envoyeLe.toISOString().slice(0, 10),
      envoyes: ligne.envoyes,
      ouvertures: ligne.ouvertures,
      clics: ligne.clics,
      conversions: ligne.conversions,
      caCents: ligne.caCents,
      desinscriptions: ligne.desinscriptions,
    }),
  )
}

export async function enregistrerResultat(userId: string, saisie: ResultatSaisi): Promise<ResultatVu> {
  const propre = resultatSchema.parse(saisie)
  const ligne = await withUserScope(userId, (tx) =>
    tx.linaResultat.create({ data: { userId, ...propre, envoyeLe: propre.envoyeLe === null ? null : new Date(propre.envoyeLe) } }),
  )
  return enrichir(ligne.id, propre)
}

export async function supprimerResultat(userId: string, id: string): Promise<void> {
  const supprimes = await withUserScope(userId, (tx) => tx.linaResultat.deleteMany({ where: { id, userId } }))
  if (supprimes.count === 0) throw notFound('Ce résultat n’existe pas.')
}
