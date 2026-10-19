-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "confirmedBy" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "address2" TEXT,
ADD COLUMN     "bcCoDirector1" TEXT,
ADD COLUMN     "bcCoDirector2" TEXT,
ADD COLUMN     "bcName" TEXT,
ADD COLUMN     "bcNumber" TEXT,
ADD COLUMN     "businessVolume" TEXT,
ADD COLUMN     "cellPhone" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "problems" TEXT,
ADD COLUMN     "yearsInBusiness" INTEGER;

