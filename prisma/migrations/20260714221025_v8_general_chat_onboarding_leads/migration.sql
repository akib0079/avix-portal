-- Leads: brand info + response message
ALTER TABLE "leads" ADD COLUMN     "brandInfo" TEXT,
ADD COLUMN     "responseMessage" TEXT;

-- Users: first-login onboarding flag
ALTER TABLE "users" ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- Messages: a thread is now (clientId, projectId). projectId = NULL means the
-- client's GENERAL thread (chatting without picking a project).
-- Add clientId nullable first so existing rows can be backfilled.
ALTER TABLE "messages" ADD COLUMN     "clientId" TEXT;
ALTER TABLE "messages" ALTER COLUMN "projectId" DROP NOT NULL;

-- Backfill: every existing message belongs to its project's client.
UPDATE "messages" m
SET "clientId" = p."clientId"
FROM "projects" p
WHERE m."projectId" = p."id" AND p."clientId" IS NOT NULL;

-- Any message whose project has no client can't belong to a thread — drop it.
-- (The UI only ever rendered a thread when a client was assigned.)
DELETE FROM "messages" WHERE "clientId" IS NULL;

-- Now it can be required.
ALTER TABLE "messages" ALTER COLUMN "clientId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "messages_clientId_projectId_createdAt_idx" ON "messages"("clientId", "projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
