-- CreateTable
CREATE TABLE "SystemAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reportedByOperatorId" TEXT NOT NULL,
    "reportedByName" TEXT NOT NULL,
    "workstationId" TEXT,
    "workstationName" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "handledByOperatorId" TEXT,
    "handledByName" TEXT,
    "resolvedAt" TEXT,
    "adminNote" TEXT
);

-- CreateIndex
CREATE INDEX "SystemAlert_status_createdAt_idx" ON "SystemAlert"("status", "createdAt");
