import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { readSetting, writeSetting } from '@/server/settings/store'

/**
 * Ce que l'exploitant peut savoir de ses connecteurs, sans rien voir de personne.
 *
 * Ce module existe à cause d'une contrainte qu'on a d'abord voulu contourner, et qu'on a eu
 * raison de ne pas contourner.
 *
 * `AdsAccount` et `IntegrationConnection` sont sous cloisonnement forcé. Une administration
 * ne parle au nom de personne : un comptage ordinaire y rend **zéro**, sans erreur et sans
 * bruit. Ce dépôt l'a déjà vécu en production — « Sites suivis » affichait zéro pendant des
 * semaines — et la décision qui a suivi tient toujours : le back-office ne contourne pas le
 * cloisonnement, et un nombre qu'on ne peut pas obtenir honnêtement ne s'affiche pas.
 *
 * Trois façons d'obtenir ces nombres existaient. Une fonction SQL privilégiée qui ne rendrait
 * que des entiers : étroite, mais c'est une brèche, et une brèche qui ne sert qu'au confort
 * ne se justifie pas. Des compteurs incrémentés à chaque événement : ils dérivent dès qu'une
 * ligne est supprimée autrement, et un compteur qui dérive ment lentement, ce qui est pire
 * qu'un compteur absent. Reste celle-ci.
 *
 * **On recompte, la nuit, en passant par la portée de chaque propriétaire.** C'est exactement
 * ce que fait déjà la tournée nocturne pour les sites : on lit les utilisateurs, qui ne sont
 * pas cloisonnés, puis chacun chez lui. Aucun privilège, aucune dérive — un recomptage
 * complet, pas une incrémentation. Le résultat est un instantané de quelques entiers, qui ne
 * décrit personne, et l'écran dit de quand il date.
 *
 * Le prix est assumé : une transaction par utilisateur et par nuit. C'est le coût d'une
 * garantie qu'on ne voulait pas défaire.
 */

/** La clé du magasin global. Les réglages d'exploitation y vivent déjà, dont le curseur. */
const CLE = 'admin.connecteurs'

/** Utilisateurs lus par page. Le nombre d'utilisateurs ne doit pas décider de la mémoire. */
const PAR_PAGE = 200

export type SantePlateforme = {
  plateforme: string
  nom: string
  /** Autorisations vivantes chez le fournisseur. */
  connexions: number
  /** Autorisations tombées : expirées, ou refusées à la dernière lecture. */
  enErreur: number
  /** Comptes publicitaires reliés, tous statuts confondus. */
  comptes: number
  /** Comptes réellement suivis : c'est ce nombre qui multiplie les appels aux plateformes. */
  suivis: number
  /** Comptes lus dans les dernières 24 heures. */
  aJour: number
}

export type CompteursConnecteurs = {
  /** Quand l'instantané a été pris, en ISO. L'écran doit le dire : il n'est pas du direct. */
  majAt: string
  /** Utilisateurs parcourus. Sert à distinguer « personne n'a rien relié » de « rien lu ». */
  utilisateurs: number
  plateformes: SantePlateforme[]
}

const PLATEFORMES: Array<{ plateforme: string; nom: string }> = [
  { plateforme: 'google-ads', nom: 'Google Ads — Naya' },
  { plateforme: 'meta-ads', nom: 'Meta Ads — MIRA' },
]

function vide(): SantePlateforme[] {
  return PLATEFORMES.map((une) => ({
    ...une,
    connexions: 0,
    enErreur: 0,
    comptes: 0,
    suivis: 0,
    aJour: 0,
  }))
}

/**
 * Recompte tout, en passant chez chacun.
 *
 * Ne lève pas sur un utilisateur : une portée qui échoue — un compte supprimé entre la
 * lecture de la liste et la sienne — ne doit pas priver l'exploitant de tous les autres.
 */
export async function recompterConnecteurs(): Promise<CompteursConnecteurs> {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const totaux = vide()
  const parPlateforme = new Map(totaux.map((une) => [une.plateforme, une]))

  let utilisateurs = 0
  let curseur: string | undefined

  for (;;) {
    const page = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAR_PAGE,
      ...(curseur === undefined ? {} : { skip: 1, cursor: { id: curseur } }),
    })
    if (page.length === 0) break
    curseur = page[page.length - 1]?.id

    for (const membre of page) {
      utilisateurs += 1
      const lu = await withUserScope(membre.id, async (tx) => {
        const connexions = await tx.integrationConnection.groupBy({
          by: ['providerId', 'status'],
          where: { userId: membre.id },
          _count: { _all: true },
        })
        const comptes = await tx.adsAccount.findMany({
          where: { userId: membre.id },
          select: { plateforme: true, actif: true, synchroAt: true },
        })
        return { connexions, comptes }
      }).catch(() => null)
      if (lu === null) continue

      for (const ligne of lu.connexions) {
        const cible = parPlateforme.get(ligne.providerId)
        if (cible === undefined) continue
        if (ligne.status === 'CONNECTED') cible.connexions += ligne._count._all
        /*
         * `EXPIRED` et `ERROR` ensemble : pour l'exploitant c'est le même événement —
         * quelqu'un dont le produit s'est arrêté sans le savoir. Les séparer ferait deux
         * colonnes qu'on additionne mentalement à chaque lecture.
         */
        if (ligne.status === 'EXPIRED' || ligne.status === 'ERROR') {
          cible.enErreur += ligne._count._all
        }
      }

      for (const compte of lu.comptes) {
        const cible = parPlateforme.get(compte.plateforme)
        if (cible === undefined) continue
        cible.comptes += 1
        if (!compte.actif) continue
        cible.suivis += 1
        if (compte.synchroAt !== null && compte.synchroAt >= hier) cible.aJour += 1
      }
    }

    if (page.length < PAR_PAGE) break
  }

  const instantane: CompteursConnecteurs = {
    majAt: new Date().toISOString(),
    utilisateurs,
    plateformes: totaux,
  }

  await writeSetting(CLE, JSON.stringify(instantane))
  /* Des entiers, et le nombre d'utilisateurs parcourus. Rien qui désigne quiconque. */
  logger.info('compteurs des connecteurs recomptés', { utilisateurs })
  return instantane
}

/**
 * Le dernier instantané, ou `null` quand aucun n'a été pris.
 *
 * `null` n'est pas zéro, et l'écran doit les distinguer : le premier veut dire « la nuit
 * n'est pas encore passée », le second « personne n'a rien relié ». Les confondre ferait
 * chercher une panne là où il n'y a qu'une attente.
 */
export async function lireCompteursConnecteurs(): Promise<CompteursConnecteurs | null> {
  const brut = await readSetting(CLE)
  if (brut === null) return null
  try {
    const lu = JSON.parse(brut) as CompteursConnecteurs
    if (typeof lu.majAt !== 'string' || !Array.isArray(lu.plateformes)) return null
    return lu
  } catch {
    return null
  }
}
