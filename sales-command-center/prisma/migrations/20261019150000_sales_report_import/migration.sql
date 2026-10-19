-- AlterEnum
ALTER TYPE "ImportKind" ADD VALUE 'SALES_REPORT';

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "sourceDetails" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_externalRef_key" ON "Opportunity"("externalRef");

