-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "goStatus" TEXT,
ADD COLUMN     "runDate" TEXT,
ADD COLUMN     "signed44" BOOLEAN NOT NULL DEFAULT false;
