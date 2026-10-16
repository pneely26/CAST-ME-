-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "calledToDesk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tentativeRunDate" TEXT;
