-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "retainerId" TEXT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_retainerId_fkey" FOREIGN KEY ("retainerId") REFERENCES "retainers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
