-- Les événements clés comptés comme prospects. NULL : Nova les reconnaît à leur nom.
ALTER TABLE "NovaReglages" ADD COLUMN IF NOT EXISTS "prospects" JSONB;
