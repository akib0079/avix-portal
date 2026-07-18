-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "invoicePdfExternalUrl" TEXT,
ADD COLUMN     "invoicePdfOriginalName" TEXT,
ADD COLUMN     "invoicePdfPath" TEXT;
