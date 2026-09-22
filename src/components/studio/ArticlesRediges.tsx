'use client'

import { useEffect, useMemo, useState } from 'react'
import { sujetsProches } from '@/lib/sujets-proches'

/**
 * Les articles écrits par Milo.
 *
 * C'est l'action la plus chère du produit, et l'écran doit s'en montrer digne. Cinq partis
 * pris, chacun contre une façon de décevoir.
 *
 * **Ce que l'analyse reproche est affiché avant le bouton.** Un bouton « écrire un article »
 * posé seul demande à quelqu'un d'inventer un sujet, ce qu'il ne sait pas faire et ce pour
 * quoi il paie. Les manques relevés sont la réponse à « sur quoi ? », et ils sont gratuits.
 *
 * **L'écran dit sur quoi le sujet sera choisi, avant de payer.** Search Console relié, Milo
 * part de ce que les gens tapent réellement ; sinon, des manques du site. Ce n'est pas la
 * même chose, et découvrir laquelle après avoir dépensé trente crédits serait désagréable.
 *
 * **Le sujet est facultatif.** Qui a une idée l'écrit ; qui n'en a pas laisse Milo choisir et
 * lira pourquoi. Un champ obligatoire aurait bloqué exactement les gens qu'on veut aider.
 *
 * **Le prix est annoncé sur le bouton, pas découvert après.** La fourchette vient du
 * catalogue administrable ; le débit réel suit les jetons.
 *
 * **L'article se copie en un geste.** Evoliia ne publie rien — le texte doit donc partir
 * d'ici vers le site de la personne sans qu'elle ait à le reconstituer morceau par morceau.
 *
 * **Rien ne promet un résultat.** Un article bien écrit rend une page reprenable. Il ne
 * garantit ni position, ni apparition dans un assistant, et l'écran ne le laisse pas croire.
 */

/** Ce dont l'écran a besoin pour ne pas promettre une source qui n'est pas là. */
export type ManqueVu = {
  checkId: string
  label: string
  why: string
  affected: number
}

/** Une photo de la boutique, rapprochée d'une section. Jamais une image créée. */
export type IllustrationVue = {
  section: number
  titre: string
  image: string
  alt: string
  lien: string | null
}

export type ArticleResumeVu = {
  id: string
  sujet: string
  titre: string
  wordCount: number
  creditsSpent: number
  createdAt: string
}

export type ArticleCompletVu = ArticleResumeVu & {
  demande: string
  fondement: string
  checkIds: string[]
  recherches: string[]
  illustrations: IllustrationVue[]
  /** L'écran Shopify où relire le brouillon, une fois déposé. */
  shopifyUrl: string | null
  chapo: string
  corps: string
  questions: { question: string; reponse: string }[]
  metaTitle: string
  metaDescription: string
}

/** Un pluriel qui ne s'excuse pas d'un « (s) ». */
function pluriel(nombre: number, mot: string): string {
  return nombre > 1 ? `${mot}s` : mot
}

function enClair(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Le rendu du corps.
 *
 * Volontairement minuscule : le schéma de rédaction ne produit que des intertitres, des
 * paragraphes et des listes à puces. Une bibliothèque Markdown complète apporterait des
 * tableaux, du HTML brut et une surface d'attaque, pour trois formes qu'on connaît déjà.
 */
/**
 * Une photo de la boutique, telle que la boutique la sert.
 *
 * Aucune copie : l'adresse pointe l'image que la boutique héberge déjà. Evoliia n'en stocke
 * aucune, n'en paie aucune, et l'article se colle tel quel là où ces images vivent. Le lien
 * vers la fiche est du maillage interne, et il est gratuit.
 */
function Photo({ photo }: { photo: IllustrationVue }) {
  const image = (
    <img
      src={photo.image}
      alt={photo.alt}
      loading="lazy"
      className="m-0 w-full rounded-[var(--radius-control)] border border-[var(--color-line)]"
    />
  )
  return (
    <figure className="m-0 mt-3 mb-1">
      {photo.lien === null ? (
        image
      ) : (
        <a href={photo.lien} target="_blank" rel="noopener noreferrer">
          {image}
        </a>
      )}
      {/*
        La légende porte le lien, en plus de l'image. Une image cliquable sans rien qui le
        dise demande de survoler pour le découvrir ; et pour un moteur, l'ancre d'un
        lien-image se réduit à son texte alternatif.
      */}
      <figcaption className="mt-1 text-xs text-[var(--color-ink-faint)]">
        {photo.lien === null ? (
          photo.titre
        ) : (
          <a href={photo.lien} target="_blank" rel="noopener noreferrer" className="underline">
            {photo.titre}
          </a>
        )}
      </figcaption>
    </figure>
  )
}

function Corps({
  texte,
  illustrations,
}: {
  texte: string
  illustrations: readonly IllustrationVue[]
}) {
  const blocs = texte.split(/\n{2,}/u).filter((bloc) => bloc.trim() !== '')
  /*
   * Les sections sont comptées en avançant : le corps est du texte, pas une structure, et
   * c'est le rang de l'intertitre qui dit à quelle section une photo appartient.
   */
  let section = -1

  return (
    <>
      {blocs.map((bloc, rang) => {
        const propre = bloc.trim()
        const cle = `${rang}-${propre.slice(0, 24)}`

        if (propre.startsWith('## ')) {
          section += 1
          const photo = illustrations.find((image) => image.section === section)
          return (
            <div key={cle}>
              <h3 className="mt-6 mb-2 text-base font-semibold">{propre.slice(3).trim()}</h3>
              {photo === undefined ? null : <Photo photo={photo} />}
            </div>
          )
        }

        const lignes = propre.split('\n')
        if (lignes.every((ligne) => /^\s*[-*]\s+/u.test(ligne))) {
          return (
            <ul key={cle} className="mt-2 mb-0 list-disc pl-5 text-sm leading-relaxed">
              {lignes.map((ligne) => (
                <li key={ligne} className="mt-1">
                  {ligne.replace(/^\s*[-*]\s+/u, '')}
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={cle} className="mt-3 mb-0 text-sm leading-relaxed">
            {propre}
          </p>
        )
      })}
    </>
  )
}

/** L'article entier en Markdown, tel qu'il partira vers le site. */
function enMarkdown(article: ArticleCompletVu): string {
  /*
   * Les images sont réinsérées sous leur intertitre. Le corps est du texte : on le recoupe
   * sur les intertitres pour retrouver les sections, exactement comme l'écran les compte.
   */
  const corps = article.corps
    .split(/\n(?=## )/u)
    .map((section, rang) => {
      const photo = article.illustrations.find((image) => image.section === rang)
      if (photo === undefined) return section
      const balise = `![${photo.alt}](${photo.image})`
      const avecLien = photo.lien === null ? balise : `[${balise}](${photo.lien})`
      // La légende, cliquable elle aussi : c'est elle que lit un moteur, et un lecteur.
      const sous =
        photo.titre === ''
          ? ''
          : photo.lien === null
            ? `*${photo.titre}*`
            : `*[${photo.titre}](${photo.lien})*`
      const lignes = section.split('\n')
      // Après l'intertitre, avant le texte : c'est là qu'elle se lira comme elle s'affiche.
      return [lignes[0], '', avecLien, ...(sous === '' ? [] : ['', sous]), ...lignes.slice(1)].join(
        '\n',
      )
    })
    .join('\n')

  const questions =
    article.questions.length === 0
      ? ''
      : [
          '\n## Questions fréquentes\n',
          ...article.questions.map((paire) => `### ${paire.question}\n\n${paire.reponse}\n`),
        ].join('\n')

  return [`# ${article.titre}`, '', article.chapo, '', corps, questions].join('\n').trim()
}

export function ArticlesRediges({
  siteId,
  host,
  locale,
  manques,
  articles: initiaux,
  cout,
  recherchesBranchees,
  sujetPropose = '',
  langueProposee = null,
}: {
  siteId: string
  host: string
  locale: string
  manques: readonly ManqueVu[]
  articles: readonly ArticleResumeVu[]
  /** Search Console est relié : le sujet se choisira sur la demande réelle, pas sur le site. */
  recherchesBranchees: boolean
  /**
   * Un sujet apporté par le calendrier, prérempli dans le champ.
   *
   * Prérempli et non imposé : c'est une proposition tirée de chiffres, et la personne
   * connaît son métier mieux que le classement. Le champ reste modifiable et effaçable.
   */
  sujetPropose?: string
  /**
   * La langue dans laquelle écrire, quand le calendrier l'a mesurée.
   *
   * Elle ne vient pas d'une devinette : c'est celle de la page sur laquelle Google classe
   * cette requête. Écrire en français un sujet demandé en italien reviendrait à payer un
   * texte que personne de ce public ne lira.
   */
  langueProposee?: string | null
  /** La fourchette annoncée, ou `null` quand le catalogue ne la donne pas. */
  cout: { min: number; max: number } | null
}) {
  const [liste, setListe] = useState<ArticleResumeVu[]>([...initiaux])
  const [ouvert, setOuvert] = useState<ArticleCompletVu | null>(null)
  const [demande, setDemande] = useState(sujetPropose)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  /*
   * Le dépôt qu'on vient de faire, et l'article auquel il appartient.
   *
   * L'identifiant n'est pas décoratif : sans lui, déposer un article puis en ouvrir un
   * second montrait au second le lien Shopify du premier, et l'invitait à relire un
   * brouillon qui n'était pas le sien.
   */
  const [depot, setDepot] = useState<{ articleId: string; lien: string } | null>(null)
  /*
   * Le refus du dépôt a son propre état, et s'affiche sous le bouton.
   *
   * Il partageait celui de la rédaction, affiché en haut de l'écran : sur un article
   * déplié, le bouton est à deux écrans de là. La personne cliquait, ne voyait rien
   * bouger, et concluait que le bouton ne marchait pas — alors que Shopify avait
   * répondu, et expliqué pourquoi.
   */
  const [erreurDepot, setErreurDepot] = useState<string | null>(null)
  /*
   * Les blogs de la boutique, et celui qui recevra l'article.
   *
   * `null` tant que rien n'a été demandé : une boutique en a souvent plusieurs — Bougies,
   * Minéraux, Bijoux — et déposer dans le premier que Shopify renvoie revient à choisir au
   * hasard pour quelqu'un qui sait très bien où va son texte. La liste n'est demandée qu'à
   * l'ouverture d'un article non déposé : chaque appel frappe un jeton chez Shopify, et
   * personne ne doit attendre pour une liste qu'il ne regardera pas.
   */
  const [blogs, setBlogs] = useState<{ id: string; titre: string }[] | null>(null)
  const [blogChoisi, setBlogChoisi] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [copie, setCopie] = useState(false)

  /*
   * Les articles qui traitent déjà ce sujet, recalculés pendant qu'on tape.
   *
   * Rien ne partait vers le serveur et rien n'était dépensé : le calcul est un comptage de
   * mots sur une liste déjà chargée. C'est ce qui permet de prévenir **avant** le clic
   * plutôt qu'après l'article — un avertissement qui arrive après la dépense n'en est plus
   * un, c'est un reproche.
   */
  const doublons = useMemo(() => sujetsProches(demande, liste), [demande, liste])

  /*
   * Un seul chargement par visite, déclenché par l'ouverture d'un article pas encore
   * déposé. Le relire ensuite ne redemande rien : la liste des blogs d'une boutique ne
   * bouge pas pendant qu'on lit un article.
   */
  const lienDepot =
    ouvert === null
      ? null
      : (ouvert.shopifyUrl ?? (depot?.articleId === ouvert.id ? depot.lien : null))
  const aDeposer = ouvert !== null && lienDepot === null
  useEffect(() => {
    if (!aDeposer || blogs !== null) return
    let vivant = true
    void (async () => {
      const response = await fetch('/api/boutique/blogs').catch(() => null)
      const body = (await response?.json().catch(() => null)) as
        | { blogs?: { id: string; titre: string }[] }
        | null
      if (!vivant) return
      // Une liste absente n'est pas une erreur à montrer : le dépôt dira lui-même pourquoi.
      setBlogs(body?.blogs ?? [])
      setBlogChoisi(body?.blogs?.[0]?.id ?? '')
    })()
    return () => {
      vivant = false
    }
  }, [aDeposer, blogs])

  async function ecrire() {
    if (occupe) return
    setOccupe(true)
    setErreur(null)

    const response = await fetch(`/api/sites/${siteId}/articles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      /*
       * La langue mesurée par le calendrier l'emporte sur celle de l'écran. C'est la même
       * consigne que d'habitude, avec une autre valeur : Milo écrit dans la langue qu'on
       * lui donne, et le calendrier sait laquelle Google associe à cette requête.
       */
      body: JSON.stringify({ demande: demande.trim(), locale: langueProposee ?? locale }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as
      | { article?: ArticleCompletVu; message?: string }
      | null
    setOccupe(false)

    if (response === null || !response.ok || body?.article === undefined) {
      setErreur(body?.message ?? 'L’article n’a pas abouti. Rien ne vous a été débité.')
      return
    }
    const article = body.article
    setListe((actuels) => [article, ...actuels])
    setOuvert(article)
    setDemande('')
  }

  async function ouvrir(id: string) {
    if (ouvert?.id === id) {
      setOuvert(null)
      return
    }
    const response = await fetch(`/api/articles/${id}`).catch(() => null)
    const body = (await response?.json().catch(() => null)) as
      | { article?: ArticleCompletVu }
      | null
    if (body?.article !== undefined) {
      setErreurDepot(null)
      setOuvert(body.article)
    }
  }

  async function supprimer(id: string) {
    const response = await fetch(`/api/articles/${id}`, { method: 'DELETE' }).catch(() => null)
    if (response === null || !response.ok) return
    setListe((actuels) => actuels.filter((article) => article.id !== id))
    if (ouvert?.id === id) setOuvert(null)
  }

  /**
   * Dépose l'article dans Shopify, en brouillon.
   *
   * L'état local sert à faire disparaître le bouton sans recharger : le serveur a déjà
   * enregistré le dépôt, et c'est lui qui refusera un second envoi quoi qu'affiche l'écran.
   */
  async function deposer(article: ArticleCompletVu) {
    setEnvoi(true)
    setErreurDepot(null)
    const response = await fetch(`/api/articles/${article.id}/shopify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blogId: blogChoisi }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as
      | { lien?: string; blog?: string; message?: string }
      | null
    setEnvoi(false)
    if (response === null || !response.ok || body?.lien === undefined) {
      setErreurDepot(body?.message ?? 'Le dépôt dans Shopify n’a pas abouti.')
      return
    }
    setDepot({ articleId: article.id, lien: body.lien })
  }

  async function copier(article: ArticleCompletVu) {
    try {
      await navigator.clipboard.writeText(enMarkdown(article))
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {
      setErreur('La copie n’a pas fonctionné. Sélectionnez le texte à la main.')
    }
  }

  return (
    <div className="grid gap-6">
      {/* Ce que l'analyse reproche au contenu. Gratuit, et c'est la réponse à « sur quoi ? ». */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <img
            src="/equipe/milo.webp"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
          <p className="m-0 flex-1 text-sm leading-relaxed">
            <strong>Milo</strong> écrit un article de fond pour <strong>{host}</strong>, à partir
            {recherchesBranchees
              ? ' de ce que les gens tapent réellement sur Google pour vous trouver, et de ce que l’analyse reproche à votre contenu.'
              : ' de ce que l’analyse reproche à votre contenu.'}
          </p>
        </div>

        {manques.length === 0 ? (
          <p className="mt-4 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
            Votre dernière analyse ne relève aucun manque de contenu.{' '}
            {recherchesBranchees
              ? 'Milo choisira alors le sujet dans vos recherches Google — ou dites-lui le vôtre.'
              : 'Dites alors sur quoi vous voulez un article — sans sujet, Milo n’aurait rien sur quoi s’appuyer.'}
          </p>
        ) : (
          <div className="mt-4">
            <p className="m-0 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
              Ce qui manque à votre contenu
            </p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {manques.map((manque) => (
                <li
                  key={manque.checkId}
                  className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm"
                >
                  <span className="font-medium">{manque.label}</span>{' '}
                  <span className="text-[var(--color-ink-faint)]">
                    — {manque.affected} {pluriel(manque.affected, 'page')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {langueProposee === null ? null : (
          <p className="mt-4 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
            Cette recherche vous amène sur une page en «&nbsp;{langueProposee}&nbsp;» : Milo
            écrira dans cette langue.
          </p>
        )}

        <label className="mt-5 block">
          <span className="text-sm font-medium">Un sujet en tête ? (facultatif)</span>
          <input
            type="text"
            value={demande}
            maxLength={400}
            onChange={(event) => setDemande(event.target.value)}
            placeholder="Choisir une bougie selon la pièce où elle brûle"
            className="mt-1.5 w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm"
          />
          <span className="mt-1.5 block text-xs text-[var(--color-ink-faint)]">
            Si vous laissez vide, Milo choisit le sujet à partir des manques ci-dessus et vous
            dit pourquoi.
          </span>
        </label>

        {doublons.length === 0 ? null : (
          /*
            Un avertissement, jamais un blocage.
            
            Écrire deux fois sur un sujet est parfois voulu — un angle vraiment différent,
            une mise à jour, une autre langue — et Evoliia n'a pas à en décider à la place
            de qui paie. Mais elle doit dire ce qu'elle voit : trois pages qui visent la
            même recherche se concurrencent entre elles, et Google n'en classe qu'une.
            C'est précisément le contenu dupliqué que l'analyse reproche ensuite au site.

            Le rapprochement est approximatif et le dit : il nomme les articles concernés
            plutôt que d'affirmer un doublon, pour qu'on puisse juger sur pièces.
          */
          <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-caution,#b54708)]/30 bg-[var(--color-caution-soft,#fffaeb)] p-3">
            <p className="m-0 text-sm font-medium">
              Vous avez déjà {doublons.length === 1 ? 'un article' : `${doublons.length} articles`}{' '}
              très {doublons.length === 1 ? 'proche' : 'proches'} de ce sujet
            </p>
            <ul className="mt-1.5 mb-0 grid list-none gap-1 p-0">
              {doublons.slice(0, 3).map((article) => (
                <li key={article.id} className="text-xs text-[var(--color-ink-soft)]">
                  · {article.titre}
                </li>
              ))}
            </ul>
            <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Deux pages qui visent la même recherche se concurrencent entre elles, et Google
              n’en classe qu’une — c’est le contenu dupliqué que l’analyse reproche ensuite à
              votre site. Si votre angle est vraiment différent, écrivez quand même : ce
              n’est qu’un rapprochement de mots, il ne lit pas vos articles.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={ecrire}
          disabled={occupe}
          className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border-0 bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {occupe
            ? 'Milo écrit…'
            : cout === null
              ? 'Faire écrire l’article'
              : `Faire écrire l’article (${cout.min} à ${cout.max} crédits)`}
        </button>

        {occupe ? (
          <p className="mt-3 mb-0 text-xs text-[var(--color-ink-faint)]">
            Un article de fond demande une minute ou deux. Laissez cette page ouverte.
          </p>
        ) : null}

        {erreur === null ? null : (
          <p className="mt-3 mb-0 text-sm text-[var(--color-danger,#b42318)]">{erreur}</p>
        )}

        {/*
          Evoliia ne publie rien et ne promet rien : un article rend une page reprenable, il
          ne garantit ni position ni apparition dans un assistant. Le dire ici plutôt que de
          laisser l'espoir se former tout seul.
        */}
        <p className="mt-4 mb-0 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-faint)]">
          Evoliia n’écrit pas sur votre site : l’article se copie d’ici. Il est rédigé pour
          être repris par un moteur ou un assistant, ce qui ne garantit aucune position ni
          aucune apparition — personne ne peut le promettre.
        </p>
      </div>

      {liste.length === 0 ? null : (
        <div className="grid gap-3">
          {liste.map((article) => {
            const deplie = ouvert?.id === article.id
            return (
              <div
                key={article.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]"
              >
                {/*
                  Le titre ouvrait déjà l'article, et rien ne le disait : pas de chevron,
                  pas de libellé, du texte noir sur fond blanc. Le seul élément qui
                  ressemblait à un bouton était « Retirer » — c'est-à-dire que la seule
                  action visible sur un article payé huit à vingt crédits était de le
                  supprimer. Personne ne clique sur ce qui ne se présente pas comme
                  cliquable, et tout le monde finit par cliquer sur ce qui s'y présente.

                  L'ouverture porte donc son libellé et son chevron, dans la zone
                  cliquable ; le retrait redevient ce qu'il doit être, discret et à part.
                */}
                <div className="flex flex-wrap items-center gap-3 p-5">
                  <button
                    type="button"
                    onClick={() => void ouvrir(article.id)}
                    aria-expanded={deplie}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{article.titre}</span>
                      <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">
                        {article.wordCount} mots · {article.creditsSpent}{' '}
                        {pluriel(article.creditsSpent, 'crédit')} ·{' '}
                        {enClair(article.createdAt, locale)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-brand-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-strong)]">
                      {deplie ? 'Fermer' : 'Lire l’article'}
                      <span aria-hidden="true">{deplie ? '▴' : '▾'}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void supprimer(article.id)}
                    className="cursor-pointer border-0 bg-transparent px-1 py-1.5 text-xs text-[var(--color-ink-faint)] underline"
                  >
                    Retirer
                  </button>
                </div>

                {!deplie || ouvert === null ? null : (
                  <div className="border-t border-[var(--color-line)] p-5">
                    {ouvert.fondement === '' ? null : (
                      <p className="m-0 mb-4 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
                        <strong>Pourquoi ce sujet :</strong> {ouvert.fondement}
                      </p>
                    )}

                    {/*
                      Sur quoi le sujet a été choisi. Un article écrit sur une demande mesurée
                      et un article écrit sur une déduction n'ont pas la même valeur : le dire
                      permet de relire celui-ci dans un an sans avoir à s'en souvenir.
                    */}
                    {ouvert.recherches.length === 0 ? null : (
                      <p className="m-0 mb-4 text-xs text-[var(--color-ink-soft)]">
                        Écrit à partir de vos chiffres de recherche Google :{' '}
                        {ouvert.recherches.slice(0, 6).map((requete, index) => (
                          <span key={requete}>
                            {index === 0 ? '' : ', '}
                            <span className="text-[var(--color-ink)]">« {requete} »</span>
                          </span>
                        ))}
                        {ouvert.recherches.length > 6
                          ? ` et ${ouvert.recherches.length - 6} autres.`
                          : '.'}
                      </p>
                    )}

                    <p className="m-0 text-sm leading-relaxed font-medium">{ouvert.chapo}</p>
                    <Corps texte={ouvert.corps} illustrations={ouvert.illustrations} />

                    {ouvert.questions.length === 0 ? null : (
                      <>
                        <h3 className="mt-6 mb-2 text-base font-semibold">Questions fréquentes</h3>
                        <dl className="m-0">
                          {ouvert.questions.map((paire) => (
                            <div key={paire.question} className="mt-3">
                              <dt className="m-0 text-sm font-medium">{paire.question}</dt>
                              <dd className="m-0 mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                                {paire.reponse}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    )}

                    {/* Les balises, demandées d'emblée : sans elles, l'article créerait le défaut suivant. */}
                    <div className="mt-6 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3">
                      <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
                        À coller dans les réglages de la page
                      </p>
                      <p className="mt-2 mb-0 text-sm">
                        <span className="text-[var(--color-ink-faint)]">Titre : </span>
                        {ouvert.metaTitle}
                      </p>
                      <p className="mt-1 mb-0 text-sm">
                        <span className="text-[var(--color-ink-faint)]">Description : </span>
                        {ouvert.metaDescription}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void copier(ouvert)}
                      className="mt-4 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm"
                    >
                      {copie ? 'Copié' : 'Copier l’article'}
                    </button>

                    {/*
                      Le dépôt dans Shopify. Un brouillon, jamais une publication : le
                      marchand relit chez lui, dans l'écran qu'il connaît, et publie
                      lui-même. Le bouton laisse place à un lien une fois le dépôt fait —
                      un second envoi créerait un doublon dans la boutique.
                    */}
                    <div className="mt-4 grid gap-2 border-t border-[var(--color-line)] pt-4">
                      {lienDepot !== null ? (
                        <a
                          href={lienDepot}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[var(--color-ink-soft)]"
                        >
                          Brouillon déposé dans Shopify — le relire et le publier ↗
                        </a>
                      ) : (
                        <>
                          {blogs === null || blogs.length < 2 ? null : (
                            <label className="block">
                              <span className="text-sm font-medium">Dans quel blog ?</span>
                              <select
                                value={blogChoisi}
                                onChange={(event) => setBlogChoisi(event.target.value)}
                                className="mt-1.5 w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm"
                              >
                                {blogs.map((blog) => (
                                  <option key={blog.id} value={blog.id}>
                                    {blog.titre}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <button
                            type="button"
                            disabled={envoi}
                            onClick={() => void deposer(ouvert)}
                            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm"
                          >
                            {envoi ? 'Envoi…' : 'Envoyer dans Shopify (brouillon)'}
                          </button>
                          <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                            Evoliia dépose un brouillon non publié. Vous le relisez dans
                            Shopify et vous le publiez vous-même — elle ne publie jamais
                            seule.
                          </p>
                          {erreurDepot === null ? null : (
                            <p className="m-0 text-sm text-[var(--color-danger,#b42318)]">
                              {erreurDepot}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
