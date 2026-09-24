-- Prenotazioni dell'accettatore: Infinity assegna ogni prenotazione a un accettatore
-- (accettatore_prenotazione -> o_operai). La pratica ne tiene matricola e nome, l'account
-- dell'operatore la propria matricola: «Le mie prenotazioni» in dashboard sono l'incrocio.
ALTER TABLE "Appointment" ADD COLUMN "assignedAdvisorCode" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "assignedAdvisorName" TEXT;
CREATE INDEX "Appointment_businessDate_assignedAdvisorCode_idx" ON "Appointment"("businessDate", "assignedAdvisorCode");
ALTER TABLE "Operator" ADD COLUMN "infinityAdvisorCode" TEXT;
