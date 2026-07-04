-- CreateEnum
CREATE TYPE "PaymentRegion" AS ENUM ('US_ACH', 'INTERNATIONAL_SWIFT', 'EU_SEPA');

-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('ADMIN', 'CLIENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE_RECEIVED';

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "region" "PaymentRegion" NOT NULL,
    "holderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankNote" TEXT,
    "fields" JSONB NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "MessageSenderRole" NOT NULL,
    "body" JSONB NOT NULL,
    "readByAdminAt" TIMESTAMP(3),
    "readByClientAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_accounts_isActive_position_idx" ON "payment_accounts"("isActive", "position");

-- CreateIndex
CREATE INDEX "messages_projectId_createdAt_idx" ON "messages"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
