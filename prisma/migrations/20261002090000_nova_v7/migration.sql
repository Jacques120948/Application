-- Nova V7 : les cohortes de clients, en parts et en moyennes — jamais un identifiant.
ALTER TABLE "CommerceSynchro" ADD COLUMN IF NOT EXISTS "cohortes" JSONB;
