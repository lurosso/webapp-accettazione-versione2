-- Dal 2026-09-24 il ruolo Responsabile/BDC (SUPERVISOR) non esiste più: il BDC non usa l'app, gli
-- assenti gli arrivano come lead nel suo CRM. Gli account con quel ruolo (compreso l'accesso veloce
-- di sviluppo dev.bdc) vengono disattivati; se l'amministratore ne riattiva uno, torna come
-- accettatore.
UPDATE "Operator" SET "isActive" = 0, "role" = 'ADVISOR' WHERE "role" = 'SUPERVISOR';
