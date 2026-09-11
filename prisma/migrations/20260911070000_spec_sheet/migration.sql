-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "runningCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "specSheet" JSONB,
ADD COLUMN     "specSheetAt" TIMESTAMP(3);

