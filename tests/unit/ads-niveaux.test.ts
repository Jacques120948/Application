import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { frequence, NIVEAU_CAMPAGNE, niveauAnnonce, niveauGroupe } from '@/server/ads/niveaux'
import { AUTOPILOTE_OUVERT, MODES_ADS, modeValide, peutEcrire } from '@/lib/modes-ads'

/**
 * Le piège que la table de relevés partagée vient de créer, et le verrou qui le referme.
 *
 * Trois étages cohabitent désormais dans `AdsReleve` : campagne, ensemble de publicités,
 * annonce. Une somme de dépense qui oublie de filtrer l'étage additionne les trois et compte
 * **la même dépense trois fois**. Rien ne casse : le total reste un nombre plausible, aucune
 * exception n'est levée, et le budget mensuel paraît dépassé alors qu'il ne l'est pas — avec
 * au bout un garde-fou qui refuse une hausse parfaitement légitime.
 *
 * Aucun test de comportement ne l'attraperait tant que Meta n'écrit rien. Celui-ci lit donc
 * le code source : toute lecture de `adsReleve` doit nommer son étage.
 */

function fichiers(dossier: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin))
    else if (chemin.endsWith('.ts') || chemin.endsWith('.tsx')) trouves.push(chemin)
  }
  return trouves
}

describe('les étages du relevé', () => {
  /*
   * Le contrôle porte sur chaque appel, et non sur le fichier.
   *
   * Une première version demandait seulement que le fichier mentionne un étage quelque
   * part. Elle passait en vert après qu'on eut retiré le filtre — une garantie qui ne
   * garantissait rien, et le genre de test qui rassure jusqu'au jour où il aurait dû
   * parler. On lit donc ce qui suit immédiatement chaque appel.
   */
  const LECTURES = ['findMany', 'findFirst', 'findUnique', 'aggregate', 'groupBy', 'count']
  const ETAGE = /NIVEAU_CAMPAGNE|niveauGroupe|niveauAnnonce|groupeId\s*:|annonceId\s*:/u

  /** Le corps de l'appel : du `(` ouvrant jusqu'à sa parenthèse fermante. */
  function corps(source: string, depart: number): string {
    let profondeur = 0
    for (let index = depart; index < source.length; index += 1) {
      const signe = source[index]
      if (signe === '(') profondeur += 1
      else if (signe === ')') {
        profondeur -= 1
        if (profondeur === 0) return source.slice(depart, index + 1)
      }
    }
    return source.slice(depart)
  }

  it('aucune lecture de relevé n’oublie de nommer son étage', () => {
    const coupables: string[] = []

    for (const chemin of fichiers('src')) {
      const source = readFileSync(chemin, 'utf8')
      for (const lecture of LECTURES) {
        const marque = `adsReleve.${lecture}(`
        let depuis = source.indexOf(marque)
        while (depuis !== -1) {
          const appel = corps(source, depuis + marque.length - 1)
          if (!ETAGE.test(appel)) coupables.push(`${chemin} → ${marque}`)
          depuis = source.indexOf(marque, depuis + 1)
        }
      }
    }

    expect(coupables).toEqual([])
  })

  it('le filtre de campagne vise bien les deux colonnes', () => {
    // Filtrer sur le seul groupe laisserait passer les annonces, qui portent un groupe.
    expect(NIVEAU_CAMPAGNE).toEqual({ groupeId: '', annonceId: '' })
  })

  it('un ensemble se lit sans ses annonces', () => {
    expect(niveauGroupe('123')).toEqual({ groupeId: '123', annonceId: '' })
  })

  it('une annonce se lit par son seul identifiant', () => {
    expect(niveauAnnonce('abc')).toEqual({ annonceId: 'abc' })
  })
})

describe('la fréquence', () => {
  it('est calculée et jamais stockée : deux vues par personne', () => {
    expect(frequence(1000, 500)).toBe(2)
  })

  it('se tait quand la plateforme ne donne pas la portée', () => {
    // Google ne la rend pas. Une division par rien vaut mieux tue que devinée.
    expect(frequence(1000, 0)).toBe(0)
  })

  it('ne fabrique rien à partir de zéro affichage', () => {
    expect(frequence(0, 500)).toBe(0)
  })
})

describe('les trois modes', () => {
  it('retombe sur la lecture pour toute valeur inconnue', () => {
    /*
     * Le sens du repli est la sécurité même : une donnée abîmée, un mode retiré, et c'est
     * le refus qui l'emporte. L'inverse aurait ouvert l'écriture sur une chaîne vide.
     */
    for (const bruit of [undefined, null, '', 'ASSISTE', 'pilote', 42]) {
      expect(modeValide(bruit)).toBe('lecture')
    }
  })

  it('reconnaît les trois modes déclarés', () => {
    for (const mode of MODES_ADS) expect(modeValide(mode)).toBe(mode)
  })

  it('n’ouvre l’écriture qu’au mode assisté tant que le pilote n’est pas livré', () => {
    expect(peutEcrire('lecture')).toBe(false)
    expect(peutEcrire('assiste')).toBe(true)
    expect(peutEcrire('autopilote')).toBe(AUTOPILOTE_OUVERT)
  })

  it('le pilote automatique est déclaré fermé', () => {
    /*
     * Ce test tombera le jour où le pilote sera livré, et c'est son rôle : il force à
     * relire ses bornes plutôt qu'à le laisser s'ouvrir par un booléen changé en passant.
     */
    expect(AUTOPILOTE_OUVERT).toBe(false)
    expect(peutEcrire('autopilote')).toBe(false)
  })
})
