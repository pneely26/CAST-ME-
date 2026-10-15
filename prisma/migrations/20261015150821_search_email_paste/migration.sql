-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('CASTING_NOTICE', 'AGENCY_SUBMISSION');

-- AlterEnum
ALTER TYPE "WebSourceKind" ADD VALUE 'SEARCH';

-- AlterTable
ALTER TABLE "WebSource" ADD COLUMN     "query" TEXT;

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "fromAddress" TEXT,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3),
    "bodyText" TEXT NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "parsed" JSONB,
    "status" "FindingStatus" NOT NULL DEFAULT 'NEW',
    "createdIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_messageId_key" ON "EmailMessage"("messageId");

-- CreateIndex
CREATE INDEX "EmailMessage_status_idx" ON "EmailMessage"("status");
