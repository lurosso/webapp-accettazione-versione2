-- Riprova automatica e gestione manuale delle notifiche: quando ritentare, quanti tentativi
-- automatici sono stati fatti, chi ha preso in carico il contatto e con che esito è stato chiuso.
ALTER TABLE "NotificationJob" ADD COLUMN "nextAttemptAt" TEXT;
ALTER TABLE "NotificationJob" ADD COLUMN "autoRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotificationJob" ADD COLUMN "claimedByOperatorId" TEXT;
ALTER TABLE "NotificationJob" ADD COLUMN "claimedByName" TEXT;
ALTER TABLE "NotificationJob" ADD COLUMN "claimedAt" TEXT;
ALTER TABLE "NotificationJob" ADD COLUMN "manualOutcome" TEXT;
ALTER TABLE "NotificationJob" ADD COLUMN "manualConfirmedAt" TEXT;
CREATE INDEX "NotificationJob_status_nextAttemptAt_idx" ON "NotificationJob"("status", "nextAttemptAt");

-- Caricamenti dal tablet ripetibili: l'identificativo scelto dal tablet rende idempotente un nuovo
-- invio dello stesso file (la risposta si era persa, la rete era caduta a metà).
ALTER TABLE "MediaAsset" ADD COLUMN "clientUploadId" TEXT;
CREATE UNIQUE INDEX "MediaAsset_appointmentId_clientUploadId_key" ON "MediaAsset"("appointmentId", "clientUploadId");
