\# ANALISI DEI REQUISITI E FLUSSI OPERATIVI



\## 1. Visone Generale

Il sistema gestisce l'accoglienza e il flusso dei veicoli in officina eliminando la gestione cartacea e riducendo le attese. Il perimetro software si concentra sull'operatività degli accettatori, la trasparenza dello stato per il cliente finale e la continuità delle comunicazioni.



\## 2. Dettaglio dei Moduli



\### A. Web App Accettatori

\- \*\*Sincronizzazione:\*\* Alle 06:00 il sistema acquisisce l'agenda da Infinity.

\- \*\*Informativa Visiva:\*\* L'accettatore vede i clienti ordinati per orario di prenotazione con codice identificativo progressivo (es. F001, F002).

\- \*\*Operatività:\*\* Interfaccia monopagina snella con stati in evidenza:

&#x20; - `In Attesa`: Stato iniziale scaricato da Infinity.

&#x20; - `In Carico`: L'accettatore prende in carico il veicolo.

&#x20; - `Salta`: La vettura viene momentaneamente posposta.

&#x20; - `Completato`: La lavorazione di accettazione è finita; il veicolo libera la campata.

\- \*\*Interoperabilità:\*\* Filtro nativo sul proprio Brand/Sportello con opzione di sblocco vista globale per assorbire il carico di lavoro di altri sportelli.



\### B. Portale Cliente (QR Code)

\- Posizionato all'ingresso delle corsie tramite QR Code.

\- Il cliente inquadra il codice con lo smartphone e inserisce la targa della vettura.

\- Visualizzazione immediata di:

&#x20; 1. Codice di prenotazione assegnato.

&#x20; 2. Numero di clienti in attesa prima di lui.



\### C. Engine Comunicazioni (Spoki \& SMS Hosting)

\- Messaggio WhatsApp automatico di promemoria inviato la mattina post-sync tramite Spoki.

\- Tracciamento della consegna: se il canale WhatsApp fallisce, il sistema inoltra automaticamente un SMS tramite API SMS Hosting garantendo la copertura per clienti anziani o senza smartphone.



\### D. Schermi Campate Officina (Opzionale)

\- 4 monitor posizionati in corrispondenza delle 4 campate d'accettazione.

\- Mostrano in tempo reale il numero identificativo del cliente in fase di servimento su quella specifica campata.

\- Quando la pratica passa a `Completato`, il display mostra una segnalazione grafica di uscita/libero.



\### E. Acquisizione Media Tablet (Opzionale)

\- Modulo mobile/tablet integrato nei pulsanti di presa in carico.

\- Permette all'accettatore di scattare foto o registrare brevi video dello stato della carrozzeria/veicolo, salvandoli al fascicolo della pratica.



\### F. Integrazione CRM / BDC

\- Le anomalie di flusso e gli appuntamenti non rispettati (No-Show) generano una chiamata API/Webhook verso il CRM aziendale per le attività di ricontatto da parte del BDC.

