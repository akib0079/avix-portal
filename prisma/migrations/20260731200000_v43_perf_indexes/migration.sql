-- Indexes for the access patterns the pages actually use: every list is
-- "ORDER BY createdAt DESC LIMIT n", which without an index means sorting the
-- whole table. CONCURRENTLY is deliberately not used — these tables are small
-- today, and a plain CREATE INDEX keeps the migration transactional.
CREATE INDEX IF NOT EXISTS "projects_createdAt_idx" ON "projects"("createdAt");
CREATE INDEX IF NOT EXISTS "invoices_createdAt_idx" ON "invoices"("createdAt");
CREATE INDEX IF NOT EXISTS "leads_createdAt_idx" ON "leads"("createdAt");

-- The overdue-invoice chaser filters on status + dueDate every duty run.
CREATE INDEX IF NOT EXISTS "invoices_status_dueDate_idx" ON "invoices"("status", "dueDate");
