-- CreateEnum
CREATE TYPE "Region" AS ENUM ('CHICAGO', 'NEW_YORK', 'LOS_ANGELES', 'ATLANTA', 'SOUTHEAST', 'NATIONWIDE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'CASTING_CLOSED', 'IN_PRODUCTION', 'WRAPPED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNKNOWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BlindSpotClassification" AS ENUM ('PUBLIC_MATCH', 'AGENCY_REPORTED_NOT_FOUND', 'POSSIBLE_DUPLICATE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('UNREVIEWED', 'CONFIRMED_PUBLIC', 'CONFIRMED_NOT_FOUND', 'DISMISSED');

-- CreateEnum
CREATE TYPE "Relevance" AS ENUM ('HIGH', 'POSSIBLE', 'LOW');

-- CreateEnum
CREATE TYPE "WatchType" AS ENUM ('CASTING_DIRECTOR', 'CASTING_OFFICE', 'PLATFORM', 'PROJECT', 'REGION');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NEW_MATCH', 'WATCHLIST_ACTIVITY', 'POTENTIAL_BLIND_SPOT', 'DEADLINE_APPROACHING', 'REPEAT_CASTING_DIRECTOR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('IMPORT', 'CREATE', 'EDIT', 'DELETE', 'BLIND_SPOT_CREATED', 'BLIND_SPOT_RESOLVED', 'WATCHLIST_ADDED', 'WATCHLIST_REMOVED');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "platform" TEXT,
    "productionType" TEXT,
    "unionStatus" TEXT,
    "region" "Region",
    "filmingLocation" TEXT,
    "genre" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'UNKNOWN',
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "agencyReported" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CastingDirector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "castingOffice" TEXT,
    "city" TEXT,
    "state" TEXT,
    "website" TEXT,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CastingDirector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCasting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "castingDirectorId" TEXT NOT NULL,
    "role" TEXT,
    "castingOffice" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCasting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicBreakdown" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "region" "Region",
    "postedDate" TIMESTAMP(3),
    "submissionDeadline" TIMESTAMP(3),
    "visibility" "Visibility" NOT NULL DEFAULT 'UNKNOWN',
    "sourceUrl" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "roleName" TEXT,
    "roleType" TEXT,
    "characterDescription" TEXT,
    "ageRange" TEXT,
    "gender" TEXT,
    "ethnicity" TEXT,
    "unionStatus" TEXT,
    "castingDirectorRaw" TEXT,
    "castingOfficeRaw" TEXT,
    "relevance" "Relevance",
    "relevanceDetails" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PublicBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencySubmission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "projectTitleRaw" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "role" TEXT,
    "castingDirectorRaw" TEXT,
    "dateSubmitted" TIMESTAMP(3),
    "platform" TEXT,
    "region" "Region",
    "unionStatus" TEXT,
    "status" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Agency report',
    "notes" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AgencySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlindSpot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agencySubmissionId" TEXT,
    "candidateProjectId" TEXT,
    "detectionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "BlindSpotClassification" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchDetails" JSONB,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "BlindSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "type" "WatchType" NOT NULL,
    "value" TEXT NOT NULL,
    "castingDirectorId" TEXT,
    "projectId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActorProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "union" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "castingRange" TEXT NOT NULL,
    "playingAgeMin" INTEGER NOT NULL,
    "playingAgeMax" INTEGER NOT NULL,
    "gender" TEXT NOT NULL,
    "castingProfile" TEXT NOT NULL,
    "primaryWork" TEXT[],
    "training" TEXT[],
    "additional" TEXT[],
    "targetMarkets" TEXT[],
    "targetPlatforms" TEXT[],
    "roleTypes" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Platform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "deliveredTo" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "rowsFound" INTEGER NOT NULL,
    "rowsValid" INTEGER NOT NULL,
    "rowsInvalid" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "imported" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_normalizedTitle_idx" ON "Project"("normalizedTitle");

-- CreateIndex
CREATE INDEX "Project_platform_idx" ON "Project"("platform");

-- CreateIndex
CREATE INDEX "Project_region_idx" ON "Project"("region");

-- CreateIndex
CREATE UNIQUE INDEX "CastingDirector_normalizedName_key" ON "CastingDirector"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCasting_projectId_castingDirectorId_key" ON "ProjectCasting"("projectId", "castingDirectorId");

-- CreateIndex
CREATE INDEX "PublicBreakdown_submissionDeadline_idx" ON "PublicBreakdown"("submissionDeadline");

-- CreateIndex
CREATE INDEX "PublicBreakdown_postedDate_idx" ON "PublicBreakdown"("postedDate");

-- CreateIndex
CREATE INDEX "AgencySubmission_normalizedTitle_idx" ON "AgencySubmission"("normalizedTitle");

-- CreateIndex
CREATE UNIQUE INDEX "BlindSpot_agencySubmissionId_key" ON "BlindSpot"("agencySubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_type_value_key" ON "WatchlistItem"("type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Platform_name_key" ON "Platform"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ProjectCasting" ADD CONSTRAINT "ProjectCasting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCasting" ADD CONSTRAINT "ProjectCasting_castingDirectorId_fkey" FOREIGN KEY ("castingDirectorId") REFERENCES "CastingDirector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicBreakdown" ADD CONSTRAINT "PublicBreakdown_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencySubmission" ADD CONSTRAINT "AgencySubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpot" ADD CONSTRAINT "BlindSpot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpot" ADD CONSTRAINT "BlindSpot_candidateProjectId_fkey" FOREIGN KEY ("candidateProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpot" ADD CONSTRAINT "BlindSpot_agencySubmissionId_fkey" FOREIGN KEY ("agencySubmissionId") REFERENCES "AgencySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_castingDirectorId_fkey" FOREIGN KEY ("castingDirectorId") REFERENCES "CastingDirector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
