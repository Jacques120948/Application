/**
 * Envoi d'une photo depuis un formulaire, côté navigateur.
 *
 * La photo part avant que le formulaire ne soit validé : il faut bien la montrer à celui
 * qui vient de la choisir, et une image ne se transporte pas dans le JSON d'une fiche sans
 * l'alourdir d'un tiers. Ce qui est ensuite enregistré dans la fiche est un identifiant.
 *
 * Ce module vit dans `lib` parce que les deux surfaces en ont besoin : l'application
 * publiée, où le visiteur remplit le formulaire, et l'atelier, où le créateur corrige une
 * fiche. Deux copies de cette règle finiraient par accepter des choses différentes.
 *
 * Rien n'est validé ici qui fasse autorité : le serveur relit les octets, refuse ce qui
 * n'est pas une image, ré-encode le reste. Les contrôles ci-dessous évitent un aller-retour
 * inutile, rien de plus.
 */

export type UploadedPhoto = { id: string; width: number; height: number }

/** Ce que le sélecteur de fichier propose. Le serveur, lui, juge sur les octets. */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif'

/** L'adresse d'une photo déjà enregistrée. La vignette suffit partout sauf en grand. */
export function photoUrl(projectId: string, photoId: string, variant: 'full' | 'thumb'): string {
  const suffixe = variant === 'thumb' ? '?format=thumb' : ''
  return `/api/app/${projectId}/medias/${photoId}${suffixe}`
}

export async function uploadPhoto(projectId: string, file: File): Promise<UploadedPhoto> {
  const corps = new FormData()
  corps.append('photo', file)

  let response: Response
  try {
    response = await fetch(`/api/app/${projectId}/photos`, { method: 'POST', body: corps })
  } catch {
    throw new Error("L'envoi de la photo a échoué. Vérifiez votre connexion.")
  }

  // Une réponse qui n'est pas du JSON vient de l'hébergeur et non de l'application : sans
  // ce filet, le bouton resterait en attente pour toujours.
  const body = (await response.json().catch(() => null)) as {
    photo?: UploadedPhoto
    message?: string
  } | null
  if (body === null || !response.ok || body.photo === undefined) {
    throw new Error(body?.message ?? "Cette photo n'a pas pu être enregistrée.")
  }
  return body.photo
}
