import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import sharp from 'sharp'
import { generateGeminiImage } from '@/server/integrations/providers/gemini'
import { VISIBILITY_AGENTS, type VisibilityAgent } from '@/server/agents/visibility'

/**
 * Fabrique les portraits de l'équipe.
 *
 * Il vit dans le dépôt, et se lance à la main, pour une raison simple : la clé Google est un
 * secret. Elle appartient à l'exploitant, elle vit dans ses variables d'environnement, et
 * elle ne doit traverser ni un chat, ni un journal, ni un fichier versionné. Le script la
 * lit là où elle est déjà — nulle part ailleurs.
 *
 *   npx tsx scripts/avatars-equipe.ts
 *   npx tsx scripts/avatars-equipe.ts gia milo
 *
 * Il demande la clé au lancement si elle n'est pas déjà dans l'environnement. C'est
 * délibéré : une consigne de la forme `GEMINI_API_KEY=votre_clé npx tsx …` se recolle telle
 * quelle, avec le texte d'exemple à la place de la clé, et Google répond alors « clé
 * invalide » — un message qu'on met un moment à relier à un copier-coller. Une invite ne
 * laisse rien à remplacer. La saisie n'est pas affichée et ne passe pas dans l'historique du
 * terminal.
 *
 * Sans argument, il refait les quatre. Avec des prénoms, il ne refait que ceux-là — et
 * c'est la bonne façon d'en reprendre un seul. **Ne supprimez jamais les fichiers avant de
 * lancer** : chacun n'est réécrit qu'après une génération réussie, si bien qu'un refus de
 * Google laisse l'ancien portrait en place. Les supprimer d'avance retire ce filet, et une
 * page d'accueil avec quatre images cassées coûte plus cher qu'un portrait qu'on trouve
 * tiède.
 *
 * Il écrit dans `public/equipe/`. Rien n'est envoyé nulle part, rien n'est enregistré en
 * base : ce sont des fichiers de marque, ils se versionnent comme le logo.
 *
 * Trois partis pris.
 *
 * **Une seule famille visuelle.** Le socle du prompt est commun aux quatre et ne varie pas ;
 * seuls changent le rôle, l'expression et la couleur du fond. C'est ce qui fait qu'on les
 * reconnaît comme une équipe plutôt que comme quatre images achetées au même endroit.
 *
 * **Le fond suit la teinte de l'agent**, celle-là même que porte sa pastille dans
 * l'interface. Le portrait et son cadre parlent alors la même langue.
 *
 * **Rien n'est copié.** Le style — 3D illustré, doux, moderne — est une direction, pas une
 * source : un style ne se possède pas, une image oui. Aucun visage réel, aucune marque,
 * aucun texte dans l'image.
 */

const DOSSIER = 'public/equipe'

/**
 * Demande la clé, sans l'afficher.
 *
 * Le masquage passe par `_writeToOutput`, le seul point où `readline` laisse décider ce qui
 * s'affiche pendant la frappe : on écrit l'invite, puis plus rien — comme une invite de mot
 * de passe. Une première version renvoyait chaque frappe vers la sortie qu'elle venait de
 * remplacer, et s'appelait elle-même jusqu'à la pile pleine.
 *
 * Hors terminal — dans un tube, dans un script — il n'y a rien à masquer et la ligne se lit
 * telle quelle. C'est aussi ce qui rend cette fonction essayable.
 */
async function demanderLaCle(): Promise<string> {
  const invite = 'Clé Google AI (elle ne s’affichera pas) : '
  const lecteur = createInterface({ input: process.stdin, output: process.stdout })

  if (process.stdin.isTTY === true) {
    let inviteEcrite = false
    ;(lecteur as unknown as { _writeToOutput: (texte: string) => void })._writeToOutput = () => {
      if (inviteEcrite) return
      inviteEcrite = true
      process.stdout.write(invite)
    }
  }

  return new Promise<string>((resolve) => {
    lecteur.question(invite, (reponse) => {
      process.stdout.write('\n')
      lecteur.close()
      resolve(reponse.trim())
    })
  })
}

/** Côté du fichier écrit. Deux fois la plus grande taille affichée, pour les écrans fins. */
const COTE = 320

/**
 * Le socle, commun aux quatre.
 *
 * Il est long, et c'est voulu : tout ce qui n'est pas dit est décidé par le modèle, donc
 * différent d'une image à l'autre. Ce qui doit être identique doit être écrit.
 *
 * Aucun studio n'est nommé, et c'est délibéré. Citer une maison de production reviendrait à
 * demander son identité visuelle ; décrire les traits eux-mêmes — la forme des yeux, le
 * rendu de la peau, la sculpture des cheveux — donne un meilleur contrôle et ne doit rien
 * à personne.
 *
 * La direction est nettement plus caractérisée que la précédente : cheveux saturés en
 * dégradé, coupes sculptées, yeux grands et expressifs, rougeur aux joues. Un portrait
 * d'application se regarde à quarante pixels de côté, et c'est le caractère qui survit à
 * cette taille, pas la finesse.
 */
const SOCLE = [
  'A single original 3D-rendered stylised character portrait for a modern app interface.',
  'Strongly stylised cartoon proportions: large expressive eyes with clear highlights, soft rounded',
  'features, smooth matte skin with a warm blush on the cheeks and nose, gentle confident closed-mouth smile.',
  'Boldly sculpted hair rendered as clean solid strands with a vivid two-tone colour gradient —',
  'the hair is a defining trait of the character, not a neutral detail.',
  'Head-and-shoulders bust, face centred and facing the viewer, soft even studio lighting,',
  'polished render, crisp edges, high detail on the face and hair.',
  'Smooth vertical gradient background, no scenery, no props, no furniture, no shadow on the background.',
  'Absolutely no text, no letters, no numbers, no logos, no watermark, no brand of any kind.',
  /*
   * Ce qu'on veut, dit en positif. La version précédente écrivait « never childish or
   * babyish » : Google a refusé les quatre portraits d'affilée, et c'était la seule
   * différence avec la version qui passait. Les classifieurs de sécurité lisent ce
   * vocabulaire sans lire la négation qui le précède — dire ce qu'on veut coûte le même
   * nombre de mots et ne se fait pas refuser.
   */
  'Not photorealistic. A mature, confident, competent professional in their late twenties or thirties.',
  'A single character, centred, with even margins on all sides so the image can be cropped',
  'to a circle without cutting the hair or the head.',
].join(' ')

type Portrait = { agent: VisibilityAgent; fichier: string; prompt: string }

/**
 * Ce qui distingue chacun : son métier, son attitude, ses couleurs.
 *
 * Chacun porte un dégradé de cheveux qui lui est propre et qui reprend sa teinte dans
 * l'interface. C'est ce qui les rend reconnaissables au premier coup d'œil, à la taille où
 * on les voit vraiment : une pastille de quarante pixels dans une rangée.
 */
const DIRECTIONS: Record<string, { fichier: string; trait: string; fond: string }> = {
  audit: {
    fichier: 'lea.webp',
    trait:
      'A professional woman in her early thirties, calm and methodical. Sculpted swept-up hair with a short' +
      ' undercut on the sides, in a vivid gradient from deep violet at the roots to soft lilac at the tips.' +
      ' Bold round dark glasses as a defining trait, small hoop earring, a crisp light blazer over a' +
      ' dark top. Attentive thoughtful eyes. She reads carefully before speaking.',
    fond: 'deep violet fading to soft lilac',
  },
  seo: {
    fichier: 'neo.webp',
    trait:
      'A professional man in his early thirties, quick and analytical. Short textured hair swept up with a clean' +
      ' undercut, in a vivid gradient from deep indigo to electric blue at the tips. Bright focused eyes,' +
      ' a dark technical jacket with a raised collar. He enjoys finding the lever that moves the numbers.',
    fond: 'deep indigo fading to dusty violet',
  },
  geo: {
    fichier: 'gia.webp',
    trait:
      'A professional woman in her thirties, inventive and forward-looking. A sharp asymmetric bob with a bold sculpted sweep,' +
      ' in a vivid gradient from magenta pink to warm coral at the tips. Keen curious eyes, small' +
      ' delicate earrings, a clean minimal top. She is at ease with what is new.',
    fond: 'magenta pink fading to warm rose',
  },
  content: {
    fichier: 'milo.webp',
    trait:
      'A professional man in his late twenties, warm and creative. Tousled wavy hair with volume and movement,' +
      ' in a vivid gradient from warm amber to soft coral at the tips. Kind open eyes, a soft knitted' +
      ' jumper with a relaxed collar. He is easy to talk to and full of ideas.',
    fond: 'warm amber fading to soft coral',
  },
}

function construire(): Portrait[] {
  return VISIBILITY_AGENTS.map((agent) => {
    const direction = DIRECTIONS[agent.id]
    if (direction === undefined) throw new Error(`Aucune direction visuelle pour « ${agent.id} ».`)
    return {
      agent,
      fichier: direction.fichier,
      prompt: `${SOCLE} ${direction.trait} Background: ${direction.fond}.`,
    }
  })
}

async function main(): Promise<void> {
  /*
   * Depuis l'environnement si elle y est, sinon on la demande. Rien à remplacer dans une
   * ligne de commande, donc rien à recoller de travers.
   */
  const depuisEnv = process.env.GEMINI_API_KEY?.trim() ?? ''
  const cle = depuisEnv === '' ? await demanderLaCle() : depuisEnv
  if (cle === '') {
    console.error('Aucune clé saisie. Récupérez-la sur https://aistudio.google.com/apikey.')
    process.exitCode = 1
    return
  }
  /*
   * Une clé Google AI commence par « AIza ». Vérifier la forme ici évite quatre appels
   * réseau et surtout quatre messages trompeurs : Google répond « 400 » à une clé invalide,
   * ce qui se lit comme un refus de la description. On a cherché au mauvais endroit assez
   * longtemps pour que ce contrôle vaille ses cinq lignes.
   */
  if (!cle.startsWith('AIza')) {
    console.error(
      `Cette clé ne ressemble pas à une clé Google AI : elles commencent toutes par « AIza », celle-ci par « ${cle.slice(0, 4)} ».`,
    )
    console.error('Récupérez-la sur https://aistudio.google.com/apikey puis relancez.')
    process.exitCode = 1
    return
  }

  await mkdir(DOSSIER, { recursive: true })

  /*
   * Les prénoms passés en argument, s'il y en a. Reprendre un seul portrait est le cas le
   * plus fréquent : trois plaisent, un non.
   */
  /*
   * Les accents sont retirés des deux côtés : personne ne tape « Léa » dans un terminal, et
   * un script qui répond « aucun spécialiste ne correspond » à `lea` a tort.
   */
  const sansAccent = (nom: string): string =>
    nom
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
  const demandes = process.argv.slice(2).map(sansAccent)
  const tous = construire()
  const portraits =
    demandes.length === 0
      ? tous
      : tous.filter(
          (portrait) =>
            demandes.includes(sansAccent(portrait.agent.name)) ||
            demandes.includes(sansAccent(portrait.agent.id)),
        )

  if (portraits.length === 0) {
    console.error(
      `Aucun spécialiste ne correspond. Prénoms possibles : ${tous.map((p) => p.agent.name).join(', ')}.`,
    )
    process.exitCode = 1
    return
  }

  let produits = 0
  let cleRefusee = false

  for (const portrait of portraits) {
    process.stdout.write(`${portrait.agent.name} … `)
    const image = await generateGeminiImage(cle, portrait.prompt, '1:1')
    if (!image.ok) {
      console.log(`échec (${image.kind}) : ${image.reason}`)
      // Inutile d'insister trois fois avec une clé que Google vient de refuser.
      if (image.kind === 'key') {
        cleRefusee = true
        break
      }
      continue
    }
    /*
     * Recadré au centre et converti en webp : le format demandé est déjà carré, mais rien
     * ne garantit que le modèle l'ait exactement rendu, et un portrait d'un pixel trop large
     * se décentre dans un cercle.
     */
    const carre = await sharp(Buffer.from(image.bytes))
      .resize(COTE, COTE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88 })
      .toBuffer()
    await writeFile(join(DOSSIER, portrait.fichier), carre)
    produits += 1
    console.log(`${portrait.fichier} (${Math.round(carre.length / 1024)} Ko)`)
  }

  if (produits === portraits.length) {
    console.log(`\n${produits} portrait(s) écrit(s) dans ${DOSSIER}. Relancez l'application pour les voir.`)
    return
  }
  /*
   * Un échec ne laisse pas de trou : le fichier précédent est toujours là, puisqu'on
   * n'écrit qu'après une génération réussie. On le dit, sinon on croit avoir tout perdu.
   */
  console.log(
    `\n${produits} portrait(s) sur ${portraits.length}. Les autres gardent leur version précédente — rien n'a été perdu.`,
  )
  /*
   * Le conseil suit la cause. « Relancez en nommant ceux qui manquent » à quelqu'un dont la
   * clé est refusée, c'est l'envoyer refaire dix fois ce qui échouera dix fois.
   */
  console.log(
    cleRefusee
      ? 'Google refuse cette clé. Vérifiez-la sur https://aistudio.google.com/apikey, puis relancez.'
      : 'Relancez en nommant ceux qui manquent, par exemple : npx tsx scripts/avatars-equipe.ts gia',
  )
  process.exitCode = 1
}

await main()
