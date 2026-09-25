-- Riconsegna prevista del veicolo secondo Infinity (data_prevcons / ora_prevcons del documento):
-- la dice al cliente la conferma dell'accettazione. La scrive solo la sync, senza versione.
ALTER TABLE "Appointment" ADD COLUMN "expectedDeliveryDate" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "expectedDeliveryTime" TEXT;
