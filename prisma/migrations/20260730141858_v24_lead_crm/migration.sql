-- CreateEnum
CREATE TYPE "LeadEntryKind" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'STAGE');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "expectedCloseDate" TIMESTAMP(3),
ADD COLUMN     "lostReason" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "lead_entries" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" "LeadEntryKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_entries_leadId_createdAt_idx" ON "lead_entries"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_ownerId_idx" ON "leads"("ownerId");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_entries" ADD CONSTRAINT "lead_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_entries" ADD CONSTRAINT "lead_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
