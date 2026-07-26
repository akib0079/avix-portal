-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "clientId" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_events_createdAt_idx" ON "activity_events"("createdAt");

-- CreateIndex
CREATE INDEX "activity_events_clientId_createdAt_idx" ON "activity_events"("clientId", "createdAt");
