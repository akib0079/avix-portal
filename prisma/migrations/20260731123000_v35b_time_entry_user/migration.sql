-- Attribute logged time to the person who logged it. Nullable: historical rows
-- predate attribution and stay unattributed.
ALTER TABLE "time_entries" ADD COLUMN "userId" TEXT;
CREATE INDEX "time_entries_userId_date_idx" ON "time_entries"("userId", "date");
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
