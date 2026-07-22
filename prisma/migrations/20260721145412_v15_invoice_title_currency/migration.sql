-- CreateEnum
CREATE TYPE "InvoiceCurrency" AS ENUM ('USD', 'EUR');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "currency" "InvoiceCurrency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "title" TEXT;
