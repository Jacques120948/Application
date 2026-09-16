import { publicAppUrl } from '@/lib/apps-domain'
import { HOME_PATH } from '@/server/spec/validate'
import type { AppSpec, Page } from '@/server/spec/schema'

/**
 * Comment une application publiée se présente aux moteurs.
 *
 * Deux lecteurs, et ils ne cherchent pas la même chose.
 *
 * **Le moteur de recherche** veut classer une page parmi d'autres. Il lui faut un titre qui
 * distingue cette page-là et une description qui donne envie de l'ouvrir. Avant ce fichier,
 * les douze pages d'une application portaient le même titre et la même description — celles
 * de l'application. Onze d'entre elles se présentaient donc comme des doublons de la
 * première, ce qui est la façon la plus sûre de n'être trouvé sur aucune.
 *
 * **Le moteur génératif** ne classe pas : il répond, et il cite ses sources. Pour être cité,
 * il faut pouvoir être identifié — qui, où, quoi — et recoupé ailleurs. C'est le rôle des
 * données structurées et du fichier destiné aux machines.
 *
 * Trois règles tiennent ce fichier.
 *
 * **On n'affirme que ce qui est déclaré.** `visibility` est facultatif. Quand il manque, on
 * n'émet rien plutôt que de deviner une adresse ou un genre d'entreprise : une donnée
 * structurée fausse coûte plus cher qu'une donnée structurée absente.
 *
 * **Rien de ce qui est écrit ici n'est du code.** Les données structurées sont sérialisées
 * puis échappées avant d'atteindre la page ; une spécification ne peut donc pas refermer la
 * balise qui la porte, même si quelqu'un y écrivait exprès la chaîne qu'il faut.
 *
 * **Les faits ne montent pas dans les données structurées.** Ils vont dans le fichier des
 * machines, où ils sont lus comme des affirmations du site — pas dans schema.org, où un
 * robot ne pourrait pas les recouper avec le contenu visible et où ils passeraient au
 * mieux pour du remplissage.
 */

/** La page d'accueil porte le nom du site ; les autres s'y rattachent. */
export function pageTitle(spec: AppSpec, page: Page): string {
  const declare = page.seo?.title
  if (declare !== undefined) return declare
  return page.path === HOME_PATH ? spec.name : `${page.title} · ${spec.name}`
}

/** Faute de description propre, l'accroche de l'application : vraie, à défaut d'être précise. */
export function pageDescription(spec: AppSpec, page: Page): string {
  return page.seo?.description ?? spec.tagline
}

/**
 * Une page qu'un moteur a le droit d'indexer.
 *
 * Deux exclusions, et elles n'ont pas la même origine. Une page réservée ne montrerait
 * qu'un formulaire de connexion, et se ferait classer là-dessus. Une page marquée
 * `noindex` est publique mais sans intérêt pour qui cherche — des remerciements, une
 * confirmation —, et son créateur l'a dit.
 */
export function isIndexable(page: Page): boolean {
  return !page.requiresAuth && page.seo?.noindex !== true
}

type Donnee = Record<string, unknown>

/** Retire les clés vides : une donnée structurée à moitié remplie se lit mal. */
function compact(donnee: Donnee): Donnee {
  return Object.fromEntries(
    Object.entries(donnee).filter(([, valeur]) => {
      if (valeur === undefined || valeur === null) return false
      if (Array.isArray(valeur)) return valeur.length > 0
      return true
    }),
  )
}

/**
 * Les données structurées d'une page.
 *
 * `WebSite` est toujours émis : que ce site existe, qu'il porte ce nom et qu'il réponde à
 * cette adresse sont trois faits que personne ne conteste. Le reste dépend de ce qui a été
 * déclaré.
 */
export function structuredData(spec: AppSpec, slug: string, page: Page): Donnee[] {
  const base = publicAppUrl(slug)
  const contexte = 'https://schema.org'
  const donnees: Donnee[] = [
    compact({
      '@context': contexte,
      '@type': 'WebSite',
      name: spec.name,
      url: base,
      description: spec.tagline,
      inLanguage: spec.locale,
    }),
  ]

  const identite = spec.visibility
  if (identite?.entityType !== undefined) {
    const adresse = identite.address
    donnees.push(
      compact({
        '@context': contexte,
        '@type': identite.entityType,
        name: spec.name,
        legalName: identite.legalName,
        url: base,
        description: spec.tagline,
        telephone: identite.phone,
        email: identite.email,
        areaServed: identite.areaServed,
        sameAs: identite.sameAs,
        address:
          adresse === undefined
            ? undefined
            : compact({
                '@type': 'PostalAddress',
                streetAddress: adresse.street,
                addressLocality: adresse.locality,
                addressRegion: adresse.region,
                postalCode: adresse.postalCode,
                addressCountry: adresse.country,
              }),
      }),
    )
  }

  /*
   * Les questions fréquentes déjà écrites sur la page deviennent une donnée structurée sans
   * que personne les ressaisisse. C'est le format que les moteurs génératifs reprennent le
   * plus volontiers : une question, une réponse, rien autour.
   */
  const questions = page.blocks
    .filter((bloc) => bloc.type === 'faq')
    .flatMap((bloc) => bloc.items)
  if (questions.length > 0) {
    donnees.push({
      '@context': contexte,
      '@type': 'FAQPage',
      mainEntity: questions.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    })
  }

  return donnees
}

/**
 * Les données structurées, prêtes à être posées dans une balise.
 *
 * Les trois caractères échappés sont ceux qui permettraient de sortir de la balise ou d'en
 * ouvrir une autre. Ils sont réécrits en séquences d'échappement JSON, que tout analyseur
 * relit à l'identique : la donnée est intacte, la page reste close.
 */
export function jsonLd(donnees: readonly Donnee[]): string {
  return JSON.stringify(donnees.length === 1 ? donnees[0] : donnees)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/**
 * Le fichier que lisent les machines.
 *
 * `llms.txt` est une convention jeune : tous les moteurs ne la lisent pas encore, et
 * personne ne garantit qu'ils la liront. Elle ne coûte pourtant presque rien — le contenu
 * existe déjà, il ne s'agit que de le servir dans un format qu'une machine n'a pas besoin
 * de deviner. C'est un pari bon marché sur une pratique qui s'installe, pas une promesse
 * de résultat, et il ne faut le vendre ni le présenter autrement.
 *
 * Ce qu'on y met est exactement ce qui est déjà public : les pages ouvertes, l'identité
 * déclarée, les faits que le créateur assume. Rien qui ne soit déjà lisible en naviguant.
 */
export function appLlmsTxt(spec: AppSpec, slug: string): string {
  const base = publicAppUrl(slug)
  const lignes: string[] = [`# ${spec.name}`, '', `> ${spec.tagline}`, '', spec.description, '']

  const identite = spec.visibility
  if (identite !== undefined) {
    const faits: string[] = []
    if (identite.legalName !== undefined) faits.push(`- Raison sociale : ${identite.legalName}`)
    const adresse = identite.address
    if (adresse !== undefined) {
      const parties = [adresse.street, adresse.postalCode, adresse.locality, adresse.region]
        .filter((partie) => partie !== undefined)
        .join(', ')
      faits.push(`- Adresse : ${parties} (${adresse.country})`)
    }
    if (identite.phone !== undefined) faits.push(`- Téléphone : ${identite.phone}`)
    if (identite.email !== undefined) faits.push(`- Courriel : ${identite.email}`)
    if (identite.areaServed !== undefined) {
      faits.push(`- Zone desservie : ${identite.areaServed.join(', ')}`)
    }
    if (identite.sameAs !== undefined) {
      faits.push(`- Également présent sur : ${identite.sameAs.join(' , ')}`)
    }
    if (faits.length > 0) lignes.push('## Identité', '', ...faits, '')
    if (identite.facts !== undefined && identite.facts.length > 0) {
      lignes.push(
        '## En bref',
        '',
        ...identite.facts.map((fait) => `- ${fait}`),
        '',
      )
    }
  }

  const pages = spec.pages.filter(isIndexable)
  if (pages.length > 0) {
    lignes.push('## Pages', '')
    for (const page of pages) {
      const adresse = page.path === HOME_PATH ? base : `${base.replace(/\/$/, '')}/${page.path}`
      lignes.push(`- [${page.title}](${adresse}) : ${pageDescription(spec, page)}`)
    }
    lignes.push('')
  }

  return lignes.join('\n')
}
