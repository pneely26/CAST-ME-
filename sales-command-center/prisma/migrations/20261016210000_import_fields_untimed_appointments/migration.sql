-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "timeSet" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "sourceDetails" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_externalId_key" ON "Lead"("externalId");

