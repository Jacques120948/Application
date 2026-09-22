import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Ce que MIRA reçoit, et surtout ce qu'elle ne reçoit pas.
 *
 * Ce contexte part chez un modèle à chaque question. Deux propriétés s'y perdraient en
 * silence, et aucune ne se voit à l'usage : un calcul qu'on lui laisserait faire, et une
 * limite de la donnée qu'on oublierait de lui dire. La première se paie en chiffre faux —
 * qui ressemble à un chiffre. La seconde en affirmation trop sûre : « vos clients ont vu la
 * publicité 4,2 fois » énoncé comme un fait alors que c'est un plancher.
 */
describe('le contexte de MIRA', () => {
  const source = readFileSync('src/server/ads/contexte-meta.ts', 'utf8')

  it('ne laisse aucun calcul au modèle', () => {
    /*
     * Tout arrive calculé. Une division qui traînerait ici voudrait dire qu'on a laissé au
     * modèle le soin de la faire, ou qu'on la refait à un endroit de plus — deux façons
     * d'obtenir deux ROAS différents pour la même semaine.
     */
    expect(source).toContain('déjà calculé')
    expect(source).toContain('tu n’as aucun calcul à faire')
    // Aucun micro ne franchit la frontière : ils ne veulent rien dire dans une phrase.
    expect(source).not.toContain('Micros')
    expect(source).not.toContain('1_000_000')
  })

  it('dit la fenêtre d’attribution, et ce qu’elle n’est pas', () => {
    /*
     * Une valeur attribuée par Meta n'est pas un encaissement constaté. Sans cette phrase,
     * MIRA présenterait « 620 CHF de chiffre d'affaires » comme de l'argent reçu.
     */
    expect(source).toContain('ATTRIBUTION')
    expect(source).toContain('encaissement constaté')
  })

  it('dit que la fréquence est un plancher', () => {
    // Meta ne rend pas la portée dédoublonnée d'une période arbitraire.
    expect(source).toContain('FRÉQUENCE')
    expect(source).toContain('plancher')
  })

  it('interdit d’ajouter un constat aux règles', () => {
    /*
     * Un modèle à qui l'on montre huit diagnostics en ajoute volontiers un neuvième, qui
     * aura l'air des huit premiers sans reposer sur quoi que ce soit.
     */
    expect(source).toContain('tu n’en ajoutes aucun')
    expect(source).toContain('fabrique pas de problème')
  })

  it('écrit l’absence d’objectif plutôt que de la laisser deviner', () => {
    /*
     * « Votre ROAS de 250 % est bon » est faux pour qui travaille à 20 % de marge. Un modèle
     * à qui l'on ne dit rien suppose, et une supposition de marge se paie immédiatement.
     */
    expect(source).toContain('aucun n’est renseigné')
    expect(source).toContain('ne suppose jamais une moyenne de marché')
  })

  it('borne ce qu’il envoie', () => {
    // Un contexte plus large coûte plus cher à chaque question, pour une réponse moins nette.
    expect(source).toContain('LIGNES_MAX')
    expect(source).toContain('CONSTATS_MAX')
    expect(source).toContain('non listés ici')
  })
})

describe('le partage des deux agents publicitaires', () => {
  const dispatcheur = readFileSync('src/server/agents/visibility-context.ts', 'utf8')

  it('ne donne pas Google à MIRA ni Meta à Naya', () => {
    /*
     * Deux comptes, deux jeux de chiffres, deux métiers. Les mélanger ferait un généraliste
     * qui conseille la moyenne de deux métiers, c'est-à-dire le mauvais conseil deux fois.
     */
    const bloc = dispatcheur.slice(
      dispatcheur.indexOf("if (agent === 'meta')"),
      dispatcheur.indexOf('Milo écrit'),
    )
    expect(bloc).toContain('contexteMeta')
    expect(bloc).not.toContain('contextePublicitaire')
  })

  it('distingue un compte non relié d’un compte à zéro', () => {
    /*
     * Le premier appelle « reliez votre compte », le second « vos campagnes ne tournent
     * plus ». Les confondre ferait dire à MIRA que la publicité ne rapporte rien à quelqu'un
     * qui n'en a jamais fait.
     */
    expect(dispatcheur).toContain('Aucun compte Meta Ads n’est relié')
  })
})
