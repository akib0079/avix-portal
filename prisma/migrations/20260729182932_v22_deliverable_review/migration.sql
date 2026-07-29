-- CreateEnum
CREATE TYPE "DeliverableReview" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERABLE_REVIEWED';

-- AlterTable
ALTER TABLE "deliverables" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" "DeliverableReview",
ADD COLUMN     "reviewedAt" TIMESTAMP(3);
