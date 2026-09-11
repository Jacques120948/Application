import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'

/**
 * Identité de l'exploitant, affichée sur les pages légales.
 *
 * Elle ne peut pas vivre dans le code : chaque installation a la sienne. Elle est donc
 * enregistrée en base et se saisit depuis le back-office.
 *
 * Point important : tant qu'elle est incomplète, les pages légales le disent au lieu
 * d'inventer un nom ou une adresse. Une mention légale fausse est pire qu'absente.
 */

export const legalIdentityInput = z.object({
  entity: z.string().trim().max(120).default(''),
  address: z.string().trim().max(300).default(''),
  email: z.string().trim().max(200).default(''),
  country: z.string().trim().max(80).default(''),
  /** Numéro d'entreprise ou de TVA, quand il existe. Facultatif. */
  registration: z.string().trim().max(120).default(''),
})

export type LegalIdentity = z.infer<typeof legalIdentityInput> & { complete: boolean }

const KEYS = ['entity', 'address', 'email', 'country', 'registration'] as const
const PREFIX = 'legal.'

export async function getLegalIdentity(): Promise<LegalIdentity> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: KEYS.map((key) => `${PREFIX}${key}`) } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((row) => [row.key.slice(PREFIX.length), row.value]))
  const identity = Object.fromEntries(
    KEYS.map((key) => [key, byKey.get(key) ?? '']),
  ) as z.infer<typeof legalIdentityInput>

  // Le numéro d'entreprise n'est pas exigé : un indépendant peut ne pas en avoir.
  const complete =
    identity.entity !== '' &&
    identity.address !== '' &&
    identity.email !== '' &&
    identity.country !== ''

  return { ...identity, complete }
}

export async function saveLegalIdentity(
  input: z.infer<typeof legalIdentityInput>,
): Promise<void> {
  await prisma.$transaction(
    KEYS.map((key) =>
      prisma.siteSetting.upsert({
        where: { key: `${PREFIX}${key}` },
        update: { value: input[key] },
        create: { key: `${PREFIX}${key}`, value: input[key] },
      }),
    ),
  )
  logger.info('identité légale mise à jour')
}
