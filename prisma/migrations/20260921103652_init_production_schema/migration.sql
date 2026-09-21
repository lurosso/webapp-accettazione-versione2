-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalRef" TEXT,
    "source" TEXT NOT NULL,
    "flow" TEXT NOT NULL,
    "workOrderRef" TEXT,
    "businessDate" TEXT NOT NULL,
    "scheduledAt" TEXT NOT NULL,
    "rescheduledAt" TEXT,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "brandId" TEXT NOT NULL,
    "deskId" TEXT,
    "customerJson" TEXT NOT NULL,
    "vehicleJson" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "serviceDescription" TEXT,
    "status" TEXT NOT NULL,
    "bayId" TEXT,
    "operatorId" TEXT,
    "skipCount" INTEGER NOT NULL,
    "notes" TEXT,
    "takenAt" TEXT,
    "skippedAt" TEXT,
    "completedAt" TEXT,
    "noShowAt" TEXT,
    "cancelledAt" TEXT,
    "autoClosedAt" TEXT,
    "autoCloseConfirmedAt" TEXT,
    "customerLateNoticeAt" TEXT,
    "customerEtaAt" TEXT,
    "customerArrivedAt" TEXT,
    "orderClosedAt" TEXT,
    "legalHoldAt" TEXT,
    "legalHoldReason" TEXT,
    "lastSyncRunId" TEXT,
    "version" INTEGER NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "capturedByOperatorId" TEXT NOT NULL,
    "capturedAt" TEXT NOT NULL,
    "note" TEXT,
    "expiresAt" TEXT NOT NULL,
    "archivedAt" TEXT
);

-- CreateTable
CREATE TABLE "WorkstationClaim" (
    "workstationId" TEXT NOT NULL PRIMARY KEY,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "claimedAt" TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "deskIdsJson" TEXT NOT NULL,
    "defaultWorkstationId" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessDate" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TEXT NOT NULL,
    "finishedAt" TEXT,
    "countersJson" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "correlationId" TEXT NOT NULL,
    "triggeredByOperatorId" TEXT
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recipientPhone" TEXT,
    "whatsappOptIn" BOOLEAN NOT NULL,
    "code" TEXT NOT NULL,
    "templateVariablesJson" TEXT NOT NULL,
    "renderedText" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentChannel" TEXT,
    "attemptsJson" TEXT NOT NULL,
    "manualConfirmedBy" TEXT,
    "manualNote" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CrmOutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "anomalyKind" TEXT,
    "appointmentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "operatorNote" TEXT,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "nextAttemptAt" TEXT,
    "lastError" TEXT,
    "crmAckId" TEXT,
    "createdAt" TEXT NOT NULL,
    "sentAt" TEXT,
    "handledAt" TEXT,
    "handledByOperatorId" TEXT,
    "handledNote" TEXT
);

-- CreateTable
CREATE TABLE "Sequence" (
    "businessDate" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    PRIMARY KEY ("businessDate", "prefix")
);

-- CreateIndex
CREATE INDEX "Appointment_businessDate_status_idx" ON "Appointment"("businessDate", "status");

-- CreateIndex
CREATE INDEX "Appointment_plate_idx" ON "Appointment"("plate");

-- CreateIndex
CREATE INDEX "Appointment_code_idx" ON "Appointment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_businessDate_code_key" ON "Appointment"("businessDate", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_businessDate_externalRef_key" ON "Appointment"("businessDate", "externalRef");

-- CreateIndex
CREATE INDEX "MediaAsset_appointmentId_idx" ON "MediaAsset"("appointmentId");

-- CreateIndex
CREATE INDEX "MediaAsset_archivedAt_expiresAt_idx" ON "MediaAsset"("archivedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkstationClaim_operatorId_idx" ON "WorkstationClaim"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_username_key" ON "Operator"("username");

-- CreateIndex
CREATE INDEX "SyncRun_businessDate_startedAt_idx" ON "SyncRun"("businessDate", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationJob_idempotencyKey_key" ON "NotificationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationJob_appointmentId_idx" ON "NotificationJob"("appointmentId");

-- CreateIndex
CREATE INDEX "NotificationJob_businessDate_status_idx" ON "NotificationJob"("businessDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOutboxEvent_idempotencyKey_key" ON "CrmOutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CrmOutboxEvent_status_nextAttemptAt_idx" ON "CrmOutboxEvent"("status", "nextAttemptAt");
