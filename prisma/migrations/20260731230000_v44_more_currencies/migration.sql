-- More invoicing currencies. Additive: existing invoices keep USD/EUR.
ALTER TYPE "InvoiceCurrency" ADD VALUE IF NOT EXISTS 'GBP';
ALTER TYPE "InvoiceCurrency" ADD VALUE IF NOT EXISTS 'CAD';
ALTER TYPE "InvoiceCurrency" ADD VALUE IF NOT EXISTS 'AUD';
