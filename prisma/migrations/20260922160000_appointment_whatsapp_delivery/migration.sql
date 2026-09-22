-- Ultimo WhatsApp al cliente sulla pratica: stato (SENT/DELIVERED/READ/FAILED), tipo di messaggio,
-- quando è cambiato e id del messaggio presso Spoki. Le scrive il webhook di esito, non il banco.
ALTER TABLE "Appointment" ADD COLUMN "whatsappState" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "whatsappKind" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "whatsappAt" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "whatsappMessageId" TEXT;
