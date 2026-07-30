-- Campaign audience: recipients can be leads as well as clients.
-- Step order matters — every statement below is safe on existing rows.

-- 1. New columns, all nullable.
ALTER TABLE "campaign_recipients" ADD COLUMN "leadId" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN "email" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN "firstName" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN "company" TEXT;

-- 2. Backfill the snapshot from the client each legacy row points at.
UPDATE "campaign_recipients" cr
SET "email" = u."email",
    "firstName" = u."firstName",
    "company" = u."company"
FROM "users" u
WHERE u."id" = cr."userId";

-- 3. Swap the uniqueness key from userId to the mailed address.
DROP INDEX IF EXISTS "campaign_recipients_campaignId_userId_key";
CREATE UNIQUE INDEX "campaign_recipients_campaignId_email_key" ON "campaign_recipients"("campaignId", "email");
CREATE INDEX "campaign_recipients_leadId_idx" ON "campaign_recipients"("leadId");

-- 4. Widen userId now that email carries identity.
ALTER TABLE "campaign_recipients" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Saved audience filters.
CREATE TABLE "audience_segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audience_segments_pkey" PRIMARY KEY ("id")
);
