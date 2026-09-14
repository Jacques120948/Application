-- Images générées par l'IA avec la clé du créateur : origine et description conservées.
ALTER TABLE "MediaAsset"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'upload',
  ADD COLUMN "prompt" TEXT;

CREATE INDEX "MediaAsset_userId_origin_createdAt_idx" ON "MediaAsset"("userId", "origin", "createdAt");
