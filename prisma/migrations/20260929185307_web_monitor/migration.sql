-- CreateEnum
CREATE TYPE "WebSourceKind" AS ENUM ('RSS', 'HTML');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('NEW', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "WebSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "WebSourceKind" NOT NULL,
    "region" "Region",
    "platform" TEXT,
    "keywords" TEXT[],
    "excludeKeywords" TEXT[],
    "itemSelector" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "termsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "termsNote" TEXT,
    "minIntervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebFinding" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "publishedAt" TIMESTAMP(3),
    "region" "Region",
    "detectedDeadline" TIMESTAMP(3),
    "detectedPlatform" TEXT,
    "matchedKeywords" TEXT[],
    "status" "FindingStatus" NOT NULL DEFAULT 'NEW',
    "breakdownId" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebSource_url_key" ON "WebSource"("url");

-- CreateIndex
CREATE INDEX "WebFinding_status_idx" ON "WebFinding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WebFinding_sourceId_key_key" ON "WebFinding"("sourceId", "key");

-- AddForeignKey
ALTER TABLE "WebFinding" ADD CONSTRAINT "WebFinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WebSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
