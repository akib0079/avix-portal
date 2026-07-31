-- Invoicing: tax + discount breakdown, partial payments, credit notes,
-- payment terms and dunning state. Every column is nullable or defaulted, so
-- existing invoices keep their current meaning (amount stays the total).
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "invoices" ADD COLUMN "subtotal" DECIMAL(10,2);
ALTER TABLE "invoices" ADD COLUMN "discount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "taxRate" DECIMAL(5,2);
ALTER TABLE "invoices" ADD COLUMN "taxLabel" TEXT;
ALTER TABLE "invoices" ADD COLUMN "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "paymentTermsDays" INTEGER;
ALTER TABLE "invoices" ADD COLUMN "creditNoteForId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "lastReminderAt" TIMESTAMP(3);

-- Historical paid invoices are fully paid by definition.
UPDATE "invoices" SET "amountPaid" = "amount" WHERE "status" = 'PAID';

CREATE INDEX "invoices_creditNoteForId_idx" ON "invoices"("creditNoteForId");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creditNoteForId_fkey"
  FOREIGN KEY ("creditNoteForId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_payments_invoiceId_paidAt_idx" ON "invoice_payments"("invoiceId", "paidAt");
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
