import { describe, expect, it } from 'vitest'
import { CRO_CHECKS } from '@/server/audit/checks/cro'
import { GEO_CHECKS } from '@/server/audit/checks/geo'
import { SEO_CHECKS } from '@/server/audit/checks/seo'
import type { PageVue, SiteVu } from '@/server/audit/checks/types'
import { extractSignals } from '@/server/audit/extract'
import { buildContexte, evaluate, evaluateAll } from '@/server/audit/scoring'

/**
 * Les contrôles de conversion — ce que Cleo regarde.
 *
 * Trois dérives guettent ce catalogue plus que les deux autres, et chacune se teste ici.
 *
 * **Il ne doit rien mesurer qu'il ne mesure pas.** Evoliia n'a aujourd'hui aucune source de
 * vente reliée : ni panier, ni chiffre d'affaires, ni taux d'abandon. Un constat qui dirait
 * « vous perdez 30 % de vos visiteurs » inventerait un chiffre. Les explications sont donc
 * vérifiées une à une : aucune ne promet ni ne quantifie.
 *
 * **Il ne doit pas reprocher aux anciens audits ce qu'ils ne pouvaient pas relever.** Les
 * signaux de conversion sont apparus avec Cleo. Un audit antérieur ne les porte pas, et les
 * lire comme des zéros annoncerait « aucun bouton » sur une page qui en a peut-être dix.
 *
 * **Il ne doit juger que les pages qui cherchent à convertir.** Une page « mentions
 * légales » n'a ni prix ni avis clients, et le lui reprocher gonflerait le constat d'un
 * défaut qu'elle n'a pas.
 */

const SITE: SiteVu = {
  origin: 'https://exemple.ch',
  robotsFound: true,
  robotsBlocksHome: false,
  sitemapFound: true,
  aiBlocked: [],
}

function page(url: string, html: string, extra: Partial<PageVue> = {}): PageVue {
  return {
    url,
    path: new URL(url).pathname,
    depth: 0,
    statusCode: 200,
    bytes: 20_000,
    fetchMs: 300,
    redirects: 0,
    signals: extractSignals(html, url),
    ...extra,
  }
}

/**
 * Du remplissage qui ne déclenche rien.
 *
 * Des mots inventés, sans monnaie ni gage de confiance : la page atteint la longueur à
 * partir de laquelle elle se juge, sans qu'un mot du décor ne fasse taire un constat.
 */
function mots(combien: number): string {
  return Array.from({ length: combien }, (_, index) => `atelier${index}`).join(' ')
}

/** Le verdict d'un contrôle sur une page, par identifiant. */
function verdict(id: string, sujet: PageVue, pages: readonly PageVue[] = [sujet]) {
  const check = CRO_CHECKS.find((un) => un.id === id)
  if (check === undefined) throw new Error(`contrôle inconnu : ${id}`)
  if (check.scope !== 'page') throw new Error(`${id} n’est pas un contrôle de page`)
  return check.run(sujet, buildContexte(pages, SITE))
}

/**
 * Une page qui vend, et qui ne prête le flanc à rien.
 *
 * Elle porte tout ce que le catalogue attend : un affichage mobile déclaré, un titre, une
 * promesse d'ouverture, un bouton qui dit où il mène, un prix, des avis déclarés, les
 * réponses aux questions qu'on se pose avant de payer, et un formulaire court. Les cas
 * fautifs s'en dérivent en retirant une chose à la fois.
 */
const VENDEUSE = `<!doctype html><html lang="fr"><head>
  <title>Bougie en cire de soja | Cap-Nature</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
    "name":"Bougie en cire de soja",
    "offers":{"@type":"Offer","price":"29.90","priceCurrency":"CHF"},
    "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"64"}}</script>
</head><body>
  <h1>Bougie en cire de soja, coulée à la main</h1>
  <p>Une bougie de 180 grammes coulée dans notre atelier de Gruyère, qui brûle entre 35 et 40 heures, au prix de 29.90 CHF.</p>
  <p>Livraison en 48 heures partout en Suisse. Retours acceptés pendant 30 jours. Garantie sur la mèche. Paiement sécurisé par carte ou Twint. Une question : contactez-nous.</p>
  <p>${mots(140)}</p>
  <a href="/devis" role="button">Demander un devis</a>
  <form action="/contact">
    <input type="text" name="nom"><input type="email" name="courriel">
    <input type="tel" name="telephone"><textarea name="message"></textarea>
    <input type="hidden" name="jeton"><input type="submit" value="Envoyer">
  </form>
</body></html>`

/**
 * Une page qui affiche un prix et rien d'autre.
 *
 * Pas d'affichage mobile, pas de titre, pas d'ouverture, aucun bouton, aucun gage : c'est
 * le cas fautif de référence. Le prix est là pour qu'elle compte comme une page qui vend —
 * sans quoi la moitié du catalogue s'abstiendrait, à juste titre.
 */
const NUE = `<!doctype html><html lang="fr"><head><title>Bougie</title></head><body>
  <p>29.90 CHF</p><p>${mots(160)}</p>
</body></html>`

describe('les contrôles de conversion', () => {
  it('ne promet rien et ne chiffre rien', () => {
    /*
     * Ce test est la garde la plus importante du catalogue. Cleo constate ce qui manque sur
     * une page ; elle ne mesure aucune vente. Une explication qui glisserait vers « vous
     * gagnerez » ou « vous perdez 30 % » ferait passer une hypothèse pour une mesure, et
     * c'est exactement ce que le produit s'interdit.
     */
    const promesses =
      /\b(?:garantit?|garantissent|vous gagnerez|vous perdez|vous perdrez|augmentera|doublera|assur[ée]\s+de)\b/iu
    const pourcentage = /\d\s*%/u
    for (const check of CRO_CHECKS) {
      expect(check.why, check.id).not.toMatch(promesses)
      expect(check.why, check.id).not.toMatch(pourcentage)
      expect(check.label, check.id).not.toMatch(pourcentage)
    }
  })

  it('forme un catalogue à part, sans recouvrir les deux autres', () => {
    const ids = CRO_CHECKS.map((check) => check.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CRO_CHECKS.every((check) => check.engine === 'cro')).toBe(true)
    expect(CRO_CHECKS.every((check) => check.id.startsWith('cro.'))).toBe(true)

    const ailleurs = new Set([...SEO_CHECKS, ...GEO_CHECKS].map((check) => check.id))
    for (const id of ids) expect(ailleurs.has(id), id).toBe(false)
  })

  it('s’abstient sur un audit enregistré avant que ces relevés n’existent', () => {
    /*
     * La règle qui protège les notes déjà rendues. On reprend une page réelle et on lui
     * retire les signaux de conversion, comme le ferait un audit de l'an dernier relu
     * aujourd'hui. Les contrôles qui s'en servent doivent rendre `null` — hors sujet — et
     * non « aucun bouton », « aucun prix », « aucun avis ».
     */
    const ancienne = page('https://exemple.ch/ancienne', VENDEUSE)
    const { boutons, premierBouton, formulaires, champsMax, prix, avisDeclares, reassurance, ...reste } =
      ancienne.signals
    void boutons
    void premierBouton
    void formulaires
    void champsMax
    void prix
    void avisDeclares
    void reassurance
    const vieille: PageVue = { ...ancienne, signals: reste }

    for (const id of [
      'cro.cta.absent',
      'cro.cta.muet',
      'cro.reassurance.absente',
      'cro.livraison.absente',
      'cro.avis.absents',
      'cro.formulaire.long',
      'cro.prix.absent',
    ]) {
      expect(verdict(id, vieille), id).toBeNull()
    }
  })

  it('ne juge pas une page qui ne cherche pas à convertir', () => {
    /*
     * Des mentions légales : pas de prix, pas de formulaire, donc rien à convertir. Les
     * contrôles réservés aux pages qui vendent s'abstiennent ; ceux qui valent pour toute
     * page — un titre, un affichage mobile — continuent de s'appliquer.
     */
    const legales = page(
      'https://exemple.ch/mentions-legales',
      `<!doctype html><html lang="fr"><head><title>Mentions légales</title>
        <meta name="viewport" content="width=device-width"></head><body>
        <h1>Mentions légales</h1>
        <p>Cette page indique qui édite et qui héberge ce site, et sous quelles conditions.</p>
        <p>${mots(160)}</p></body></html>`,
    )

    expect(verdict('cro.reassurance.absente', legales)).toBeNull()
    expect(verdict('cro.avis.absents', legales)).toBeNull()
    expect(verdict('cro.livraison.absente', legales)).toBeNull()
    expect(verdict('cro.prix.absent', legales)).toBeNull()
    expect(verdict('cro.h1.absent', legales)).toBe(false)
    expect(verdict('cro.mobile.viewport', legales)).toBe(false)
  })

  it('ne reproche rien à une page en erreur ni à une page sans contenu', () => {
    const erreur = page('https://exemple.ch/perdu', '<html><head></head><body></body></html>', {
      statusCode: 404,
    })
    const maigre = page('https://exemple.ch/vide', '<html><head></head><body><p>Bonjour</p></body></html>')

    for (const check of CRO_CHECKS) {
      if (check.scope !== 'page') continue
      expect(check.run(erreur, buildContexte([erreur], SITE)), check.id).toBeNull()
      expect(check.run(maigre, buildContexte([maigre], SITE)), check.id).toBeNull()
    }
  })

  it('ne trouve rien à redire à une page qui vend correctement', async () => {
    const vendeuse = page('https://exemple.ch/bougie', VENDEUSE)
    for (const check of CRO_CHECKS) {
      if (check.scope !== 'page') continue
      expect(check.run(vendeuse, buildContexte([vendeuse], SITE)), check.id).not.toBe(true)
    }
    const resultat = await evaluate([vendeuse], SITE, CRO_CHECKS)
    expect(resultat.score).toBe(100)
  })

  it('relève ce qui manque sur une page qui affiche un prix et rien d’autre', () => {
    const nue = page('https://exemple.ch/nue', NUE)
    expect(verdict('cro.cta.absent', nue)).toBe(true)
    expect(verdict('cro.h1.absent', nue)).toBe(true)
    expect(verdict('cro.mobile.viewport', nue)).toBe(true)
    expect(verdict('cro.reassurance.absente', nue)).toBe(true)
    expect(verdict('cro.livraison.absente', nue)).toBe(true)
    expect(verdict('cro.avis.absents', nue)).toBe(true)
  })

  it('ne reproche une promesse absente qu’à une page sans une seule phrase suivie', () => {
    /*
     * `intro` est le premier paragraphe lisible de la page, où qu'il se trouve : rien ne
     * dit qu'il est en haut. En juger la longueur donnerait un constat qui se présente
     * comme une mesure sans en être une — une première version le faisait. Le contrôle ne
     * dit donc que ce qu'il sait : cette page n'a aucune phrase suivie, tout y est en
     * titres, en listes ou en images.
     */
    const enTitres = page(
      'https://exemple.ch/theme',
      `<!doctype html><html lang="fr"><head><title>Accueil</title>
        <meta name="viewport" content="width=device-width"></head><body>
        <h1>Cap-Nature</h1>
        <h2>${mots(60)}</h2><ul><li>${mots(60)}</li></ul>
        <button>Demander un devis</button></body></html>`,
    )
    expect(verdict('cro.promesse.absente', enTitres)).toBe(true)

    const avecPhrase = page(
      'https://exemple.ch/accueil',
      `<!doctype html><html lang="fr"><head><title>Accueil</title>
        <meta name="viewport" content="width=device-width"></head><body>
        <h1>Cap-Nature</h1>
        <p>Nous coulons à la main des bougies en cire de soja dans notre atelier de Gruyère.</p>
        <p>${mots(160)}</p></body></html>`,
    )
    expect(verdict('cro.promesse.absente', avecPhrase)).toBe(false)
  })

  it('juge le libellé du bouton, pas son existence', () => {
    const avec = (libelle: string) =>
      page(
        'https://exemple.ch/bouton',
        `<!doctype html><html lang="fr"><head><title>Devis</title>
          <meta name="viewport" content="width=device-width"></head><body>
          <h1>Nos prestations</h1>
          <p>Nous réalisons des bougies sur mesure pour les hôtels et les boutiques.</p>
          <button>${libelle}</button><p>${mots(160)}</p></body></html>`,
      )

    expect(verdict('cro.cta.muet', avec('Envoyer'))).toBe(true)
    expect(verdict('cro.cta.muet', avec('En savoir plus'))).toBe(true)
    expect(verdict('cro.cta.muet', avec('Demander un devis'))).toBe(false)
    // Un bouton sans libellé : rien à juger ici, c'est `cro.cta.absent` qui compte.
    expect(verdict('cro.cta.muet', avec(''))).toBeNull()
  })

  it('ne s’inquiète d’un formulaire qu’au-delà de ce qu’on remplit sans y penser', () => {
    const formulaire = (champs: number) =>
      page(
        'https://exemple.ch/contact',
        `<!doctype html><html lang="fr"><head><title>Contact</title>
          <meta name="viewport" content="width=device-width"></head><body>
          <h1>Nous écrire</h1>
          <p>Dites-nous ce que vous cherchez, nous répondons sous un jour ouvrable.</p>
          <form>${Array.from({ length: champs }, (_, i) => `<input name="c${i}">`).join('')}
          <input type="submit" value="Envoyer"></form>
          <p>${mots(160)}</p></body></html>`,
      )

    expect(verdict('cro.formulaire.long', formulaire(4))).toBe(false)
    expect(verdict('cro.formulaire.long', formulaire(6))).toBe(false)
    expect(verdict('cro.formulaire.long', formulaire(11))).toBe(true)
  })

  it('ne réclame un prix que sur une fiche produit', () => {
    const fiche = (schema: string, corps: string) =>
      page(
        'https://exemple.ch/fiche',
        `<!doctype html><html lang="fr"><head><title>Fiche</title>
          <meta name="viewport" content="width=device-width">
          <script type="application/ld+json">${schema}</script></head><body>
          <h1>Bougie de Gruyère</h1>
          <p>Une bougie coulée à la main dans notre atelier, en cire de soja.</p>
          ${corps}<p>${mots(160)}</p></body></html>`,
      )

    const produit = '{"@context":"https://schema.org","@type":"Product","name":"Bougie"}'
    const article = '{"@context":"https://schema.org","@type":"BlogPosting","headline":"Bougie"}'

    expect(verdict('cro.prix.absent', fiche(produit, ''))).toBe(true)
    expect(verdict('cro.prix.absent', fiche(produit, '<p>29.90 CHF</p>'))).toBe(false)
    // Un article de blog n'a pas de prix à afficher : le contrôle n'a rien à y dire.
    expect(verdict('cro.prix.absent', fiche(article, ''))).toBeNull()
  })

  it('rend une troisième note, distincte des deux autres', async () => {
    /*
     * Un site peut être irréprochable pour Google et perdre ses visiteurs à l'arrivée : des
     * méta complètes, un texte suffisant, et rien pour décider. C'est ce qu'une troisième
     * note sert à montrer, et ce qu'une note unique masquerait.
     */
    const propreMaisMuette = `<!doctype html><html lang="fr"><head>
      <title>Bougies artisanales de Gruyère | Cap-Nature</title>
      <meta name="description" content="Des bougies coulées à la main en Gruyère, en cire de soja, avec des parfums naturels, vendues en ligne et en boutique.">
      <link rel="canonical" href="https://exemple.ch/">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Cap-Nature"}</script>
      </head><body><h1>Bienvenue</h1><h2>Nos parfums</h2>
      <p>29.90 CHF</p><p>${mots(200)}</p>
      <img src="/p.jpg" alt="Une bougie"><a href="/parfums">Nos parfums</a></body></html>`

    const pages = [page('https://exemple.ch/', propreMaisMuette)]
    const { seo, cro } = await evaluateAll(pages, SITE)
    expect(cro.score).toBeLessThan(seo.score)
    expect(cro.constats.every((constat) => constat.engine === 'cro')).toBe(true)
    expect(seo.constats.every((constat) => constat.engine === 'seo')).toBe(true)
  })

  it('ne descend jamais sous zéro', async () => {
    const nue = page('https://exemple.ch/nue', NUE)
    const resultat = await evaluate([nue], SITE, CRO_CHECKS)
    expect(resultat.score).toBeGreaterThanOrEqual(0)
    expect(resultat.score).toBeLessThan(40)
  })
})
