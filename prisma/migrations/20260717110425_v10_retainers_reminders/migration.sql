-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RETAINER_GENERATED';

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "retainers" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedPeriod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retainers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retainers_active_dayOfMonth_idx" ON "retainers"("active", "dayOfMonth");

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
