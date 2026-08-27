-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amountUsd" DECIMAL(12,2);

-- Backfill only what can be known for certain. A USD invoice is worth its own
-- amount, so mirroring is exact and keeps every existing total unchanged.
UPDATE "invoices" SET "amountUsd" = "amount" WHERE "currency" = 'USD';

-- Non-USD rows are deliberately left NULL. Copying `amount` across would bake
-- in the very error this column exists to fix — a EUR 1400 invoice recorded as
-- $1400 — and it would be indistinguishable from a real figure afterwards. NULL
-- means "tell me", and the UI asks.
