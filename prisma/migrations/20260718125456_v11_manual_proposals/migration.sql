-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "acceptedByAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "convertedClientId" TEXT,
ADD COLUMN     "recipientCompany" TEXT,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "recipientName" TEXT,
ALTER COLUMN "leadId" DROP NOT NULL;
