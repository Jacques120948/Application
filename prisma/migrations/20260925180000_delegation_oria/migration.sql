-- Qui a posé la question à un spécialiste : la personne, ou Oria pour elle.
--
-- Une colonne sur la conversation existante plutôt qu'une table de délégations : une
-- délégation n'est rien d'autre qu'une question posée à un spécialiste, et elle vit donc là
-- où vivent les questions. Le spécialiste la voit dans son fil, la personne la retrouve dans
-- sa conversation, et la politique d'isolation de la table s'applique d'office.
--
-- Vide pour tout ce qui existait : ces questions ont été posées directement.
ALTER TABLE "VisibilityNote" ADD COLUMN "demandePar" TEXT;
