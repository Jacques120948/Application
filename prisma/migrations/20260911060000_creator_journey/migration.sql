-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('PROPOSED', 'SELECTED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "allowBuild" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isRecommended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "ideaId" UUID;

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "monthlyGoalCents" INTEGER NOT NULL,
    "weeklyHours" INTEGER NOT NULL,
    "budgetCents" INTEGER NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'France',
    "skills" TEXT NOT NULL DEFAULT '',
    "interests" TEXT NOT NULL DEFAULT '',
    "sector" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT 'particuliers',
    "ambition" TEXT NOT NULL DEFAULT 'simple',
    "preferredModel" TEXT NOT NULL DEFAULT 'indifferent',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "valueProposition" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "businessModel" TEXT NOT NULL,
    "recommendedPriceCents" INTEGER NOT NULL,
    "priceInterval" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "demandLevel" TEXT NOT NULL,
    "competitionLevel" TEXT NOT NULL,
    "complexityLevel" TEXT NOT NULL,
    "operatingCostLevel" TEXT NOT NULL,
    "timeToMarketWeeks" INTEGER NOT NULL,
    "customersNeeded" INTEGER NOT NULL,
    "risks" JSONB NOT NULL,
    "differentiators" JSONB NOT NULL,
    "validation" JSONB,
    "validatedAt" TIMESTAMP(3),
    "status" "IdeaStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE INDEX "Idea_userId_createdAt_idx" ON "Idea"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ideaId_key" ON "Project"("ideaId");

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

