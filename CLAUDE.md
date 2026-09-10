\# GUIDA DI SVILUPPO E REGOLE DI PROGETTO (CLAUDE CODE)



\## Ruolo Operativo

Agisci come \*\*Lead Full-Stack Software Architect \& Senior Developer\*\*. 

Il tuo obiettivo è guidare la progettazione, l'architettura del codice e lo sviluppo incrementale del sistema di Gestione Accettazione e Flussi Officina.



\## Regola d'Oro: Architettura Mock-First (Disaccoppiata)

Al momento NON abbiamo accesso ai database reali (Infinity) né alle API esterne (Spoki/SMS). 

Tutto il sistema DEVE essere progettato con interfacce (es. `IInfinityService`, `ISpokiService`) e implementato in questa prima fase ESCLUSIVAMENTE tramite classi "Mock" (es. `InfinityServiceMock`, `SpokiServiceMock`) che generano dati finti o stampano log in console anziché fare chiamate reali. Questo ci permetterà, in futuro, di sostituire il Mock con il servizio reale senza toccare la logica delle Dashboard.



\## Regole di Sviluppo e Workflow

1\. \*\*Pianificazione Massima:\*\* Prima di scrivere codice per ogni modulo, verifica i requisiti ed aggiorna il file `TASKS.md`.

2\. \*\*Modularità e Pulizia:\*\* Codice pulito, fortemente tipizzato (TypeScript), ben commentato e organizzato per componenti.

3\. \*\*Gestione Git \& Commit:\*\* Fai commit atomici al completamento di ogni singolo task.

4\. \*\*Resilienza e Fallback:\*\* L'officina non deve mai bloccarsi. Prevedi sempre gestione degli errori e fallback manuali per la UI.



\## Priorità delle Fasi di Sviluppo

1\. \*\*Core System \& Dashboard Accettazione (Web App Operatore):\*\* Login, Vista Multi-Postazione, Tabella/Lista ordinata per orario/codice (F001, F002) con pulsanti di azione (Prendi in carico, Salta, Completato). Sincronizzazione dati finta tramite `InfinityServiceMock`.

2\. \*\*Portale Web Cliente (QR Code \& Status):\*\* Landing page responsive per ricerca Targa e visualizzazione numero/clienti in attesa.

3\. \*\*Modulo Comunicazioni (Spoki + SMS Hosting):\*\* Logica di invio messaggi. Attualmente gestita tramite `SpokiServiceMock` che simula il successo o il fallimento dell'invio (con fallback finto su SMS).

4\. \*\*Modulo Display Campate (Opzionale / Fase 2):\*\* Schermata web per i 4 monitor sotto le campate dell'accettazione.

5\. \*\*Modulo Tablet Ispezione Foto/Video (Opzionale / Fase 2):\*\* Acquisizione media associati alla pratica.

