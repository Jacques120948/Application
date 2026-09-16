/*
 * Photos envoyées par les visiteurs.
 *
 * Une fiche d'artisan sans photo de chantier, une déclaration de sinistre sans cliché du
 * dégât, une annonce sans image : c'est ce qui séparait le plus nettement une application
 * créée ici d'un vrai outil. Les images existaient déjà — mais seulement pour le créateur,
 * et seulement pour décorer ses pages.
 *
 * Rien de nouveau n'est stocké : une photo de visiteur est une image comme les autres,
 * dans la même table, passée par le même traitement — ré-encodée, débarrassée de ses
 * métadonnées, donc de la position GPS du chantier. Deux choses seulement la distinguent.
 *
 * **Son origine dit d'où elle vient.** `visitor`, à côté de `upload` et `ai`. C'est ce qui
 * permet de ne pas la mêler à la bibliothèque du créateur, qui est un espace de travail et
 * pas une boîte de réception.
 *
 * **Elle appartient à une fiche.** La suppression est donc portée par la base : une fiche
 * effacée emporte ses photos. Sans cela, une application ouverte au public accumulerait
 * indéfiniment des images que plus rien ne désigne, et le quota de stockage du créateur se
 * remplirait de fantômes.
 *
 * Le coût, lui, reste celui qui existait déjà : le quota de stockage de l'offre. Un
 * visiteur ne peut pas créer de dépense nouvelle pour Evoliia — il peut au pire remplir
 * l'espace que le créateur a acheté, ce qui s'arrête tout seul.
 */

ALTER TABLE "MediaAsset" ADD COLUMN "recordId" UUID;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_recordId_fkey"
  FOREIGN KEY ("recordId") REFERENCES "AppRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "MediaAsset_projectId_origin_recordId_idx"
  ON "MediaAsset" ("projectId", "origin", "recordId");

/*
 * Le rattachement d'une photo à sa fiche a lieu dans la même transaction que l'écriture de
 * la fiche, donc dans la portée d'exécution — celle du visiteur, qui n'est pas le créateur.
 * La politique reste étroite : on ne peut toucher que les photos de visiteurs, et
 * seulement celles du projet en cours. La bibliothèque du créateur — son logo, ses
 * illustrations — reste hors d'atteinte de tout ce qui s'exécute pour un visiteur.
 */
CREATE POLICY mediaasset_runtime_photos ON "MediaAsset" FOR UPDATE
  USING ("projectId" = app_current_project_id() AND "origin" = 'visitor')
  WITH CHECK ("projectId" = app_current_project_id() AND "origin" = 'visitor');
