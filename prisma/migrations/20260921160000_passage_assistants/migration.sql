-- Un relevé qu'on peut quitter.
--
-- Interroger trois assistants sur quatorze questions prend plusieurs minutes. Exiger que la
-- page reste ouverte pendant ce temps est une contrainte que personne n'accepte : on ferme
-- l'onglet, on change d'écran, et le travail payé se perd au milieu.
--
-- Le travail continue donc côté serveur après la réponse, et ce qu'il a fait est durable :
-- chaque réponse d'assistant est écrite dès qu'elle arrive. Ces deux colonnes disent
-- seulement qu'un passage est en cours et combien de questions il couvre — l'avancement,
-- lui, se compte sur les relevés déjà écrits plutôt que d'être tenu à jour en double. Deux
-- compteurs qui disent la même chose finissent toujours par se contredire.

ALTER TABLE "SiteAutomatisation" ADD COLUMN "passageAt" TIMESTAMP(3);
ALTER TABLE "SiteAutomatisation" ADD COLUMN "passageAttendu" INTEGER NOT NULL DEFAULT 0;
