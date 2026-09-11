import { z } from 'zod'
import { validation } from '@/lib/errors'
import type { AppSpec } from './schema'
import { parseAppSpec } from './validate'

/**
 * Application de modifications ciblées sur une AppSpec.
 *
 * Pourquoi un patch plutôt qu'une régénération : régénérer toute l'application pour
 * « mets le bouton en bleu » coûterait cher et ferait perdre les réglages déjà faits.
 *
 * Sécurité du chemin d'accès. Un patch est produit par un modèle de langage, lui-même
 * influencé par du texte utilisateur. Le résolveur de chemin refuse donc :
 *   - les segments `__proto__`, `prototype`, `constructor` (pollution de prototype) ;
 *   - les indices négatifs ou hors bornes ;
 *   - les chemins trop profonds ;
 *   - toute traversée d'une valeur non-objet.
 *
 * Et surtout : le résultat est revalidé **entièrement**. Un patch qui produirait une
 * AppSpec invalide est rejeté en bloc, l'application de l'utilisateur reste intacte.
 */

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_DEPTH = 12

const pathPattern = /^[a-zA-Z][a-zA-Z0-9_]*(\[\d+\]|\.[a-zA-Z][a-zA-Z0-9_]*)*$/

export const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: z.string().max(300), value: z.unknown() }).strict(),
  z.object({ op: z.literal('delete'), path: z.string().max(300) }).strict(),
  z.object({ op: z.literal('append'), path: z.string().max(300), value: z.unknown() }).strict(),
  z
    .object({
      op: z.literal('insert'),
      path: z.string().max(300),
      index: z.number().int().min(0).max(200),
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      op: z.literal('move'),
      path: z.string().max(300),
      from: z.number().int().min(0).max(200),
      to: z.number().int().min(0).max(200),
    })
    .strict(),
])

export const specPatchSchema = z
  .object({
    /** Résumé en français courant, affiché dans l'historique des versions. */
    summary: z.string().min(1).max(120),
    operations: z.array(patchOperationSchema).min(1).max(40),
  })
  .strict()

export type PatchOperation = z.infer<typeof patchOperationSchema>
export type SpecPatch = z.infer<typeof specPatchSchema>

type Segment = { kind: 'key'; value: string } | { kind: 'index'; value: number }

export function parsePath(path: string): Segment[] {
  if (!pathPattern.test(path)) {
    throw validation(`Chemin de modification invalide : ${path}`)
  }
  const segments: Segment[] = []
  const pattern = /([a-zA-Z][a-zA-Z0-9_]*)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(path)) !== null) {
    if (match[1] !== undefined) {
      if (FORBIDDEN_SEGMENTS.has(match[1])) {
        throw validation('Chemin de modification refusé.')
      }
      segments.push({ kind: 'key', value: match[1] })
    } else if (match[2] !== undefined) {
      segments.push({ kind: 'index', value: Number(match[2]) })
    }
  }
  if (segments.length === 0 || segments.length > MAX_DEPTH) {
    throw validation('Chemin de modification invalide.')
  }
  return segments
}

type Container = Record<string, unknown> | unknown[]

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null
}

/** Descend jusqu'au conteneur parent du dernier segment. */
function resolveParent(root: Container, segments: Segment[]): { parent: Container; last: Segment } {
  const last = segments[segments.length - 1]
  if (last === undefined) throw validation('Chemin de modification invalide.')

  let current: unknown = root
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!
    if (!isContainer(current)) throw validation('Cette modification vise un élément inexistant.')
    current =
      segment.kind === 'key'
        ? (current as Record<string, unknown>)[segment.value]
        : (current as unknown[])[segment.value]
  }
  if (!isContainer(current)) throw validation('Cette modification vise un élément inexistant.')
  return { parent: current, last }
}

function applyOne(root: Container, operation: PatchOperation): void {
  const segments = parsePath(operation.path)
  const { parent, last } = resolveParent(root, segments)

  switch (operation.op) {
    case 'set': {
      if (last.kind === 'key') {
        if (!Array.isArray(parent)) (parent as Record<string, unknown>)[last.value] = operation.value
        else throw validation('Cette modification vise un élément inexistant.')
      } else {
        if (!Array.isArray(parent) || last.value >= parent.length) {
          throw validation('Cette modification vise un élément inexistant.')
        }
        parent[last.value] = operation.value
      }
      return
    }
    case 'delete': {
      if (last.kind === 'key') {
        if (Array.isArray(parent)) throw validation('Cette suppression est impossible.')
        delete (parent as Record<string, unknown>)[last.value]
      } else {
        if (!Array.isArray(parent) || last.value >= parent.length) {
          throw validation('Cette suppression vise un élément inexistant.')
        }
        parent.splice(last.value, 1)
      }
      return
    }
    case 'append': {
      const target = readTarget(parent, last)
      if (!Array.isArray(target)) throw validation('Cet ajout vise une liste inexistante.')
      target.push(operation.value)
      return
    }
    case 'insert': {
      const target = readTarget(parent, last)
      if (!Array.isArray(target)) throw validation('Cet ajout vise une liste inexistante.')
      if (operation.index > target.length) throw validation('Position invalide dans la liste.')
      target.splice(operation.index, 0, operation.value)
      return
    }
    case 'move': {
      const target = readTarget(parent, last)
      if (!Array.isArray(target)) throw validation('Ce déplacement vise une liste inexistante.')
      if (operation.from >= target.length || operation.to >= target.length) {
        throw validation('Position invalide dans la liste.')
      }
      const [moved] = target.splice(operation.from, 1)
      target.splice(operation.to, 0, moved)
      return
    }
  }
}

function readTarget(parent: Container, last: Segment): unknown {
  if (last.kind === 'key') {
    if (Array.isArray(parent)) throw validation('Cette modification vise un élément inexistant.')
    return (parent as Record<string, unknown>)[last.value]
  }
  if (!Array.isArray(parent)) throw validation('Cette modification vise un élément inexistant.')
  return parent[last.value]
}

/**
 * Applique un patch sur une copie, puis revalide intégralement.
 * En cas d'échec, rien n'est modifié : l'appelant garde la spécification d'origine.
 */
export function applyPatch(spec: AppSpec, patch: SpecPatch): AppSpec {
  const draft = structuredClone(spec) as unknown as Container
  for (const operation of patch.operations) {
    applyOne(draft, operation)
  }
  return parseAppSpec(draft)
}
