/**
 * Formules de calcul des applications créées.
 *
 * Elles répondent à un besoin que le déclaratif ignorait complètement : un total qui se
 * calcule tout seul. Un devis dont il faut retaper « prix × quantité » à la main n'est pas
 * un outil de gestion, c'est une feuille de papier à l'écran.
 *
 * Trois partis pris, et le premier commande les autres.
 *
 * **Ce n'est pas un langage.** Des nombres, les champs du même modèle, quatre opérations et
 * des parenthèses. Rien d'autre : ni fonction, ni condition, ni accès à quoi que ce soit.
 * Une formule est écrite par un modèle de langage à partir d'une demande d'utilisateur ;
 * elle doit donc être inévaluable autrement que comme du calcul. Il n'y a ici aucun `eval`,
 * aucune construction dynamique de code, et la grammaire est si étroite qu'il n'y a rien à
 * y injecter.
 *
 * **La valeur n'est jamais enregistrée.** Elle est recalculée à chaque lecture. Corriger un
 * prix corrige aussitôt tous les totaux ; une valeur figée en base aurait menti dès la
 * première correction, et personne n'aurait su lesquelles étaient à jour.
 *
 * **Une formule qui ne peut pas aboutir ne vaut pas zéro.** Un champ vide, une division par
 * zéro, un texte à la place d'un nombre : le résultat est « rien », pas « 0 ». Afficher un
 * zéro là où la donnée manque revient à affirmer quelque chose de faux.
 */

/** Au-delà, une formule n'est plus une formule mais un programme. */
export const MAX_FORMULA_LENGTH = 200

/** Profondeur maximale de parenthèses : borne la récursion de l'analyse. */
const MAX_DEPTH = 12

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'field'; id: string }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'negate'; value: FormulaNode }

export class FormulaError extends Error {}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'symbol'; value: '+' | '-' | '*' | '/' | '(' | ')' }

/** Découpe la formule. Tout ce qui n'est pas prévu est refusé ici, pas plus loin. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]!
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if ('+-*/()'.includes(char)) {
      tokens.push({ kind: 'symbol', value: char as '+' })
      index += 1
      continue
    }
    if (/[0-9]/.test(char)) {
      // Le point et la virgule décimale sont tous deux acceptés : le créateur écrit comme
      // il écrit, pas comme la machine préfère.
      const match = /^[0-9]+(?:[.,][0-9]+)?/.exec(source.slice(index))!
      tokens.push({ kind: 'number', value: Number(match[0].replace(',', '.')) })
      index += match[0].length
      continue
    }
    if (/[a-z]/i.test(char)) {
      // Un identifiant de champ : les mêmes caractères que les identifiants du schéma.
      const match = /^[a-z][a-z0-9-]*/i.exec(source.slice(index))!
      tokens.push({ kind: 'name', value: match[0] })
      index += match[0].length
      continue
    }
    throw new FormulaError(`Caractère inattendu dans la formule : « ${char} ».`)
  }

  return tokens
}

/**
 * Analyse la formule, ou refuse.
 *
 * Descente récursive classique : somme, puis produit, puis unaire, puis terme. L'ordre des
 * fonctions est l'ordre des priorités, ce qui rend la grammaire lisible sans commentaire.
 */
export function parseFormula(source: string): FormulaNode {
  if (source.trim() === '') throw new FormulaError('La formule est vide.')
  if (source.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`La formule dépasse ${MAX_FORMULA_LENGTH} caractères.`)
  }

  const tokens = tokenize(source)
  let position = 0

  function peek(): Token | undefined {
    return tokens[position]
  }

  function eat(value: string): boolean {
    const token = peek()
    if (token?.kind === 'symbol' && token.value === value) {
      position += 1
      return true
    }
    return false
  }

  function somme(depth: number): FormulaNode {
    let left = produit(depth)
    for (;;) {
      if (eat('+')) left = { kind: 'binary', op: '+', left, right: produit(depth) }
      else if (eat('-')) left = { kind: 'binary', op: '-', left, right: produit(depth) }
      else return left
    }
  }

  function produit(depth: number): FormulaNode {
    let left = unaire(depth)
    for (;;) {
      if (eat('*')) left = { kind: 'binary', op: '*', left, right: unaire(depth) }
      else if (eat('/')) left = { kind: 'binary', op: '/', left, right: unaire(depth) }
      else return left
    }
  }

  function unaire(depth: number): FormulaNode {
    if (eat('-')) return { kind: 'negate', value: unaire(depth) }
    if (eat('+')) return unaire(depth)
    return terme(depth)
  }

  function terme(depth: number): FormulaNode {
    if (depth > MAX_DEPTH) throw new FormulaError('La formule est trop imbriquée.')
    const token = peek()
    if (token === undefined) throw new FormulaError('La formule est incomplète.')

    if (token.kind === 'number') {
      position += 1
      return { kind: 'number', value: token.value }
    }
    if (token.kind === 'name') {
      position += 1
      return { kind: 'field', id: token.value }
    }
    if (eat('(')) {
      const inside = somme(depth + 1)
      if (!eat(')')) throw new FormulaError('Il manque une parenthèse fermante.')
      return inside
    }
    throw new FormulaError(`« ${token.value} » n'est pas attendu ici.`)
  }

  const node = somme(0)
  if (position !== tokens.length) throw new FormulaError('La formule contient quelque chose en trop.')
  return node
}

/** Les champs qu'une formule utilise, sans doublon. */
export function formulaFields(node: FormulaNode): string[] {
  const found = new Set<string>()
  const walk = (current: FormulaNode): void => {
    if (current.kind === 'field') found.add(current.id)
    else if (current.kind === 'binary') {
      walk(current.left)
      walk(current.right)
    } else if (current.kind === 'negate') walk(current.value)
  }
  walk(node)
  return [...found]
}

/**
 * Calcule, ou renvoie `null`.
 *
 * `null` signifie « on ne peut pas savoir » : une donnée manquante, une valeur qui n'est
 * pas un nombre, une division par zéro. Le distinguer de zéro n'est pas une subtilité —
 * un total affiché à 0 alors qu'un prix n'est pas renseigné fait prendre une décision sur
 * un chiffre inventé.
 */
export function evaluateFormula(
  node: FormulaNode,
  values: Record<string, unknown>,
): number | null {
  switch (node.kind) {
    case 'number':
      return node.value

    case 'field': {
      const raw = values[node.id]
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
      if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw.replace(',', '.'))
        return Number.isFinite(parsed) ? parsed : null
      }
      if (typeof raw === 'boolean') return raw ? 1 : 0
      return null
    }

    case 'negate': {
      const inner = evaluateFormula(node.value, values)
      return inner === null ? null : -inner
    }

    case 'binary': {
      const left = evaluateFormula(node.left, values)
      const right = evaluateFormula(node.right, values)
      if (left === null || right === null) return null
      if (node.op === '/' && right === 0) return null
      const result =
        node.op === '+'
          ? left + right
          : node.op === '-'
            ? left - right
            : node.op === '*'
              ? left * right
              : left / right
      // Arrondi à deux décimales : ce sont des prix, des heures et des quantités, pas de
      // l'analyse numérique. Sans cela, 0,1 + 0,2 s'afficherait 0,30000000000000004.
      return Number.isFinite(result) ? Math.round(result * 100) / 100 : null
    }
  }
}
