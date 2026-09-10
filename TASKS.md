# TASKS.md — Piano di lavoro "Gestione Accettazione e Flussi Officina"

Backlog operativo del progetto, organizzato in **Milestone → Task → Sotto-task**. È la fonte unica dello stato di avanzamento: va aggiornato **prima** di iniziare ogni milestone/modulo (regola 1 di `CLAUDE.md`) e nello stesso commit (o in quello immediatamente successivo) di ogni task completato. L'architettura di riferimento è descritta in `ARCHITECTURE.md`; le decisioni sono tracciate come ADR sintetici in `ARCHITECTURE.md` §8 e diventeranno file completi in `docs/adr/` con M0-T12 (finché non esistono, il riferimento è la tabella §8).

## Legenda

- **Stato**: `- [ ]` da fare · `- [x]` completato · `- [~]` in corso (usare con parsimonia, un solo task in corso per persona).
- **Schema ID**: `M<milestone>-T<task>-S<sotto-task>` (es. `M1-T02-S03`). Gli ID non si riutilizzano: un task rimosso resta con nota "annullato".
- **Priorità**: P1..P5 rispettano l'ordine imposto da `CLAUDE.md`; "Modulo F" (CRM/BDC) è collocato dopo P5 (ADR-012, `ARCHITECTURE.md` §8); "Fase reale" è il passaggio Mock → servizi reali.
- **Sotto-task**: piccoli (≤ ~2 h), concreti e verificabili: nominano il file/componente/interfaccia da toccare, il comportamento atteso e il file di test da scrivere. Nessun "se necessario"/"se accettato" dentro un sotto-task: le decisioni si prendono in un sotto-task dedicato e si annotano qui. "Verificato" indica sempre lo strumento e la soglia (es. «axe-core, 0 violazioni `color-contrast`»).
- **Definition of Done generale** (vale per ogni task, oltre ai criteri specifici della milestone):
  1. codice TypeScript strict, fortemente tipizzato, commentato in italiano, identificatori in inglese;
  2. `npm run typecheck` e `npm run lint` verdi (nessun import di `services/mocks|real` o `repositories/in-memory|prisma` fuori dai factory);
  3. test unit/contract/e2e previsti dal task scritti e verdi (`npm test`);
  4. errori attesi restituiti come `Result<T,E>`, nessun blocco della UI, fallback manuale presente dove previsto;
  5. commit atomico in italiano con prefisso conventional e ID task nello stesso formato di questo file (es. `feat(M1-T03): QueueService con state machine e versioning`, così `git log --grep M1-T03` lo trova); il sotto-task di commit si spunta solo dopo aver verificato l'hash con `git log -1`, annotandolo accanto alla checkbox (es. `[x] … (68c07e1)`);
  6. `TASKS.md` aggiornato (checkbox, note, eventuali nuovi task).
- **Convenzioni file**: UTF-8 senza BOM, LF, 2 spazi, apostrofo ASCII; interfacce con prefisso `I`; implementazioni delle porte esterne come `<Porta senza I><Implementazione>` con `Mock` (in `services/mocks`), `Http` (API remota) o `LocalDisk`/`Blob` (risorsa locale/cloud) in `services/real` (es. `InfinityServiceHttp`, `MediaStorageMock`, `MediaStorageLocalDisk`); repository con prefisso `InMemory`/`Prisma` (`ARCHITECTURE.md` §7).

## Stato attuale

Setup iniziale (M0-T01..T05) completato. Bootstrap manuale di Next.js eseguito (M0-T06 completo; M0-T11 quasi completo: manca `providers.tsx`, rinviato a M0-T07/M1-T09), con `.gitattributes` che forza LF; `npm run typecheck` e `npm run build` verdi (route: `ƒ /`, `○ /_not-found`, `ƒ /api/v1/health`). Package manager scelto dal PO: **npm** (`package-lock.json` versionato, nessun campo `packageManager`). Prossimo lavoro: M0-T07 (token Tailwind, shadcn/ui, editorconfig, env.example), M0-T08 (ESLint/Prettier), M0-T09 (Vitest), M0-T10 (Zod), completamento M0-T11, M0-T12, M0-T13.

- [x] **M0-T01** Documenti di setup: `CLAUDE.md` (regole, Regola d'Oro Mock-First, priorità P1..P5) e `docs/ANALISI_REQUISITI.md` (moduli A–F) (commit `68c07e1`).
- [x] **M0-T02** `ARCHITECTURE.md`: stack, albero cartelle, modello di dominio, porte/adapter, strategia mock, flusso dati e stato server-side, regola dei codici, tabella sintetica ADR-001..014 (§8; i file in `docs/adr/` arrivano con M0-T12).
- [x] **M0-T03** `TASKS.md` (questo file): milestone M0..M7 con task granulari.
- [x] **M0-T04** Impalcatura `src/` in TypeScript puro (dominio, `services/interfaces`, DTO, mapper, `services/mocks` con `InfinityServiceMock`/`SpokiServiceMock`/`SmsHostingServiceMock`/`CrmServiceMock`/`MediaStorageMock`, `repositories/in-memory`, factory, `config/container.ts`, `NotificationOrchestrator`), `.gitkeep` per le cartelle future (le sottocartelle di `src/app` nascono con M0-T11), `tsconfig.json` minimo (strict, `noUnused*`, alias `@/*`), `.gitignore`; verificato con `npx -y -p typescript@5 tsc -p tsconfig.json --noEmit` (scaffold superato dal bootstrap Next.js: `tsconfig.json` ora è quello di Next, vedi M0-T06-S04).
- [x] **M0-T05** Commit `feat(setup): inizializzazione architettura, task e impalcatura mock` (è il commit che contiene questa versione del file: hash con `git log -1`).
- [x] **M0-T06 + M0-T11 (parziale)** Bootstrap Next.js: commit unico `feat(setup): bootstrap Next.js, fix gitattributes e architettura iniziale` richiesto dal PO (hash da annotare con `git log -1` dopo il commit); copre anche `.gitattributes`, `src/instrumentation.ts` (fail-fast anticipato da M1-T06-S02), `src/app/error.tsx` e l'allineamento di `ARCHITECTURE.md`/`src/README.md`.

---

## M0 — Bootstrap Next.js e tooling

- **Priorità**: prerequisito di tutte le milestone.
- **Obiettivo**: trasformare lo scaffold TypeScript puro in un'app Next.js 16 avviabile dentro questo repo non vuoto (nessun `create-next-app`), con qualità (lint, format, test) e CI.
- **Criteri di completamento**: `npm run dev` mostra la pagina base; `GET /api/v1/health` risponde con le quattro porte esterne (Infinity, Spoki, SMS Hosting, CRM) in stato `UP` con `implementation: 'mock'` (`IMediaStorage` è escluso dall'health check: infrastruttura locale senza `healthCheck()`); `npm run typecheck && npm run lint && npm test && npm run build` verdi in locale e in CI; la regola ESLint `no-restricted-imports` blocca un import di prova di `services/mocks` da `src/app`.
- **Dipendenze**: M0-T01..T05.

### M0-T06 — package.json, npm e tsconfig definitivo
Rendere installabile il progetto senza `create-next-app`, con versioni pinnate.
- [x] M0-T06-S01 Creato `package.json` (name `webapp-accettazione`, `"private": true`, `engines.node >=22`) con script `dev`, `build`, `start`, `typecheck`. Decisioni: package manager **npm** (scelta del PO, nessun campo `packageManager`); nessun `"type": "module"` (non necessario a Next 16; `postcss.config.mjs` è ESM per estensione). Gli script `lint`, `lint:fix`, `format`, `format:check` arrivano con M0-T08, `test`/`test:watch` con M0-T09, `test:e2e` con M1-T17.
- [x] M0-T06-S02 Dipendenze pinnate (verifica del 2026-09-10): `next@16.3.4`, `react@19.3.0`, `react-dom@19.3.0`; dev `typescript@5.9.3` (TypeScript 7 è già sul registry ma **non adottato**: si attende il supporto del plugin Next e di typescript-eslint), `@types/node@24.13.4`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `postcss@8.5.28`. Le altre dipendenze si installano nel task che le usa: `@tanstack/react-query`, `zustand`, `lucide-react`, shadcn → M0-T07; `eslint`, `eslint-config-next`, `typescript-eslint`, `prettier`, `prettier-plugin-tailwindcss` → M0-T08; `vitest`, `@testing-library/react` → M0-T09; `zod` → M0-T10; `jose` → M1-T07. `ARCHITECTURE.md` §2 allineato.
- [x] M0-T06-S03 `npm install` (46 pacchetti) e `package-lock.json` (lockfileVersion 3) versionato; `node_modules` ignorato da `.gitignore` (voci del package manager precedente rimosse).
- [x] M0-T06-S04 `tsconfig.json` aggiornato: `plugins: [{ name: 'next' }]`, `incremental`, `allowJs`, `types: []` rimosso, include `next-env.d.ts`, `.next/types/**/*.ts` e `.next/dev/types/**/*.ts` (`.next` NON è in `exclude`, altrimenti il validator di Next non verrebbe compilato da `npm run typecheck`); opzioni strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, alias `@/*` mantenuti. Deviazioni: `jsx: react-jsx` (impostato da Next al primo build, da mantenere); `tests/` resta in `exclude` finché la cartella non esiste (si include in M0-T09-S01).
- [x] M0-T06-S05 `next.config.ts` con `reactStrictMode: true`, `output: 'standalone'` e commento sul vincolo di processo singolo. `typedRoutes` **non attivato** (decisione: si valuta in M1-T10 quando esistono route reali e si può verificare l'impatto su `Link`/`redirect()` con il build).
- [x] M0-T06-S06 `config/env.ts`: `readEnvSource()` legge `process.env` (tipizzato da `@types/node`, fallback `{}` dove `process` non esiste), cast su `globalThis` rimosso, commento di testa aggiornato; `npm run typecheck` verde.
- [x] M0-T06-S07 Il commit per task previsto (`chore(M0-T06): …`) è sostituito dal commit unico richiesto dal PO `feat(setup): bootstrap Next.js, fix gitattributes e architettura iniziale`, che copre M0-T06, M0-T11 (parziale) e `.gitattributes`; spuntare con l'hash dopo `git log -1`.

### M0-T07 — Tailwind 4, shadcn/ui, editorconfig, env.example
Base grafica e configurazione d'ambiente.
- [ ] M0-T07-S01 `postcss.config.mjs` (`@tailwindcss/postcss`) e `src/app/globals.css` (`@import 'tailwindcss'`) esistono dal bootstrap: aggiungere in `globals.css` i token colore per gli stati pratica (`--status-waiting`, `--status-in-progress`, `--status-skipped`, `--status-completed`, `--status-no-show`, `--status-cancelled`) definiti in `@theme`.
- [ ] M0-T07-S02 Inizializzare shadcn/ui (`components.json`, alias `@/components/ui`) e aggiungere `Button`, `Badge`, `Table`, `Dialog`, `Toast`/`Sonner`, `Select`, `Input`, `Tooltip`; nessun lock-in (codice nel repo).
- [ ] M0-T07-S03 `.editorconfig` (UTF-8, LF, 2 spazi, `insert_final_newline`); `.prettierrc`/`prettier.config.mjs` con `endOfLine: 'lf'` e plugin Tailwind. Nota: il fine riga LF è già imposto lato Git da `.gitattributes` (`* text=auto eol=lf`, fatto nel bootstrap); `.editorconfig` e Prettier lo garantiscono anche in editor.
- [ ] M0-T07-S04 `.env.example` con tutte le variabili lette da `config/env.ts` (`SERVICES_PROVIDER=mock`, `*_PROVIDER`, `REPOSITORY_PROVIDER=memory`, `MEDIA_STORAGE_PROVIDER=memory`, `APP_TIMEZONE=Europe/Rome` (mai `TZ`), `SYNC_HOUR_LOCAL=06:00`, `CODE_PREFIX=F`, `CODE_SEQUENCE_SCOPE=SITE`, `QUEUE_AHEAD_SCOPE=SITE`, interruttori `MOCK_*` inclusi `MOCK_INFINITY_CANCEL_ON_SECOND_CALL` e `MOCK_SMS_FAILURE_RATE`, `SESSION_SECRET`, `SYNC_SECRET`) con commento per riga.
- [ ] M0-T07-S05 Commit `chore(M0-T07): Tailwind 4, shadcn/ui, editorconfig ed env.example`.

### M0-T08 — ESLint 9 flat config e Prettier con guardia architetturale
Rendere meccanica la Regola d'Oro.
- [ ] M0-T08-S01 `eslint.config.mjs` flat con `eslint-config-next` e `typescript-eslint` (regole `consistent-type-imports`, `no-floating-promises`, `switch-exhaustiveness-check`).
- [ ] M0-T08-S02 Regola `no-restricted-imports` per `src/app/**`, `src/modules/**`, `src/components/**`, `src/hooks/**`, `src/application/**`: vietati `@/services/mocks*`, `@/services/real*`, `@/repositories/in-memory*`, `@/repositories/prisma*` con messaggio in italiano che rimanda ai factory. Decisione di layering (bootstrap): `application/` importa solo da `domain`, `services/interfaces`, `repositories/interfaces`, `config/constants`, MAI dai factory (nemmeno `import type`): `application/health/check-health.ts` definisce localmente `ExternalHealthPorts` e `providerKindsFromEnv()` con tipi strutturali; la regola ESLint può quindi vietare anche `@/services/factory` e `@/repositories/factory` in `src/application/**`.
- [ ] M0-T08-S03 Test negativo della regola: file temporaneo in `src/app` che importa `InfinityServiceMock` → `npm run lint` fallisce; rimuovere il file.
- [ ] M0-T08-S04 `npm run format` su tutto il repo; verificare assenza di BOM e CRLF con uno script `scripts/check-encoding.mjs` (aggiunto a `lint`; `.gitattributes` normalizza già i fine riga al commit: lo script verifica la working copy e il BOM).
- [ ] M0-T08-S05 (Opzionale) `dependency-cruiser` con regole di layering domain ← application ← services/repositories ← modules/app, eseguibile in CI.
- [ ] M0-T08-S06 Commit `chore(M0-T08): ESLint flat config, Prettier e guardia no-restricted-imports`.

### M0-T09 — Vitest e primi test dello scaffold
Verificare che lo scaffold sia corretto, non solo tipizzato.
- [ ] M0-T09-S01 `vitest.config.ts` con alias `@/`, `environment: 'node'` di default, `include: ['tests/**/*.test.ts', 'tests/**/*.contract.ts']`, coverage v8; aggiungere `tests/**/*.ts` all'`include` di `tsconfig.json` e rimuovere `tests` da `exclude` (rinviato da M0-T06-S04 perché la cartella non esisteva ancora).
- [ ] M0-T09-S02 `tests/unit/appointment-state-machine.test.ts`: tutte le transizioni consentite/vietate di `ALLOWED_TRANSITIONS`, `assertTransition` → `INVALID_TRANSITION`.
- [ ] M0-T09-S03 `tests/unit/queue-code.test.ts`: `formatQueueCode('F', 1) === 'F001'`, padding oltre 999 (`F1000`), `parseQueueCode`, `compareByScheduleThenSequence`.
- [ ] M0-T09-S04 `tests/unit/value-objects.test.ts`: `parsePlate` (AA123BB, spazi/trattini, formati UE, targhe non valide), `parsePhoneE164` (00→+, prefisso +39, punti/spazi), `lastDigits`.
- [ ] M0-T09-S05 `tests/unit/seeded-random.test.ts`: stesso seed → stessa sequenza; `seedFrom` deterministico. `tests/unit/infinity-service-mock.test.ts`: due istanze con lo stesso seed producono la stessa agenda alla prima chiamata per la stessa `businessDate`; con `cancelOnSecondCall=true` la seconda chiamata marca ~5 % di appuntamenti `cancelled` e la terza è identica alla seconda; con `cancelOnSecondCall=false` tutte le chiamate sono identiche; `externalId` cliente univoci.
- [ ] M0-T09-S06 `tests/unit/notification-orchestrator.test.ts`: con `FixedClock`, `SequentialIdGenerator` e mock: numero finale 0 → `WHATSAPP_SENT`; 7 → `SMS_FALLBACK_SENT` (UNDELIVERABLE immediato); 8 → `FAILED_RETRYABLE` (job `FAILED`); 9 → `SMS_FALLBACK_SENT`; 99 → `MANUAL_REQUIRED`; telefono null → `NO_RECIPIENT`; seconda chiamata stessa chiave → `ALREADY_PROCESSED`; job `IN_FLIGHT` più vecchio di 5 minuti → ripreso; le `variables` passate a Spoki contengono `code = F0xx` (mai l'id).
- [ ] M0-T09-S07 `tests/unit/in-memory-appointment-repository.test.ts`: `insert` duplicato (id, codice o externalRef nella giornata) → `VALIDATION`; `update` con `expectedVersion` errato → `VERSION_CONFLICT`; `reserveNextSequence` monotono; `listByDate` ordinato e `statuses: ['CANCELLED']` autoritativo; `tests/unit/in-memory-store.test.ts`: `getGlobal()` condivide lo stato fra istanze (simulazione HMR) e `reset()` è visto da tutte.
- [ ] M0-T09-S08 Commit `test(M0-T09): Vitest e test unitari dello scaffold`.

### M0-T10 — Zod al posto dei type guard manuali
Un solo linguaggio di schema per env, DTO e body HTTP.
- [ ] M0-T10-S01 `src/config/env.schema.ts`: schema Zod di `AppEnv` con default sicuri e `coerce` per numeri; `parseEnv()` usa `safeParse`, logga warning per valori non validi e ricade sui default (mai throw all'avvio in modalità mock).
- [ ] M0-T10-S02 `src/services/dto/infinity.dto.ts`: `InfinityAppointmentDtoSchema`, `InfinityAgendaDtoSchema`; tipi esportati con `z.infer` mantenendo gli stessi nomi; `isInfinityAppointmentDto` reimplementato su `safeParse`.
- [ ] M0-T10-S03 Schemi Zod per `spoki.dto.ts`, `sms-hosting.dto.ts`, `crm.dto.ts` (usati in M3/M6/M7 dai Route Handler e dai contract test).
- [ ] M0-T10-S04 Test `tests/unit/dto-schemas.test.ts` con payload validi e invalidi; `npm run typecheck` verde.
- [ ] M0-T10-S05 Commit `refactor(M0-T10): schemi Zod per env e DTO`.

### M0-T11 — App Router minimo e /api/v1/health
Primo avvio dell'app con il container reale.
- [x] M0-T11-S01 `src/app/layout.tsx` (lang `it`, font di sistema, `globals.css`, metadata in italiano).
- [ ] M0-T11-S01b `src/app/providers.tsx` (client component) con `QueryClientProvider` e `Toaster`/`Sonner`: rinviato perché `@tanstack/react-query` e shadcn non sono ancora installati; dipende da M0-T07-S02 e va completato al più tardi in M1-T09 (prima di `useQueue`).
- [x] M0-T11-S02 `src/app/page.tsx`: Server Component (`force-dynamic`) con titolo, tabella Tailwind dell'`healthCheck` delle quattro porte esterne (badge con etichette italiane e codice tecnico nel `title`, `<th scope="col">`, implementazione, dettaglio, "Ultimo controllo" formattato in `APP_TIMEZONE` con `lib/dates.ts::formatDateTimeIt`) e link a `/api/v1/health`; se il container non è costruibile (`ConfigurationError`/`NotImplementedError`) mostra un pannello in italiano con il suggerimento `SERVICES_PROVIDER=mock`. Il redirect verso `/accettazione`/`/login` arriva in M1-T10-S02.
- [x] M0-T11-S02b `src/app/error.tsx` (error boundary radice, client component): messaggio in italiano, `digest` e pulsante "Riprova" al posto della pagina generica inglese di Next. Gli `ErrorBoundary` per modulo restano nei task delle rispettive milestone.
- [x] M0-T11-S03 `src/app/api/v1/health/route.ts`: `GET(request)` (`force-dynamic`) che chiama `getContainer()` e `checkExternalHealth()`; nuovo caso d'uso `src/application/health/check-health.ts` (`aggregateHealth`, `checkExternalHealth(ports, { clock, kinds, correlationId? })`: dipende solo da `domain` e `services/interfaces` tramite il tipo locale `ExternalHealthPorts`, mai lancia, porta che lancia o non risponde entro `HEALTH_CHECK_TIMEOUT_MS` = 2000 ms → `DOWN` con `checkedAt` da `IClock` e `implementation` dall'ambiente) che restituisce `{ status: 'UP'|'DEGRADED'|'DOWN', checkedAt, providers: HealthStatus[] }`. Codici HTTP: **200 sempre** come liveness del processo (una dipendenza giù non deve far riavviare l'app: fallback manuali); `?probe=dependencies` → 503 quando `DOWN`; container non costruibile → 503 JSON `{ status: 'DOWN', checkedAt: null, providers: [], error: { name, message } }`. Header `x-correlation-id` sempre presente (riuso dell'header in ingresso, altrimenti `container.ids.next()`), propagato alle porte via `CallOptions.correlationId`.
- [x] M0-T11-S04 Verifica manuale: `npm run dev`, `/`, `/api/v1/health` e `/api/v1/health?probe=dependencies` con `SERVICES_PROVIDER=mock`. Fail-fast: `src/instrumentation.ts` (anticipato da M1-T06-S02) costruisce il container all'avvio del server, quindi con `INFINITY_PROVIDER=real` il processo fallisce all'avvio; nota: con il seed demo attuale (password `plain:`) scatta prima `ConfigurationError` (guard `assertNoDemoCredentialsOutsideMock`), non `NotImplementedError`, e per lo stesso motivo `npm start` (`NODE_ENV=production`) è atteso fallire finché il seed non viene sostituito in M1. Stato: **non eseguita** (finora verificati solo `npm run typecheck` e `npm run build`). **Esito 2026-09-10:** home 200 con le 4 porte "Operativo"; `/api/v1/health` 200 con `x-correlation-id` (riusato se presente in ingresso); `?probe=dependencies` 200; con `INFINITY_PROVIDER=real` sul build standalone il server logga subito `ConfigurationError` in italiano all'avvio ("Failed to prepare server") ma il processo resta in ascolto (unhandledRejection): la terminazione esplicita del processo va aggiunta in M1-T06-S02.
- [x] M0-T11-S05 `npm run build` verde con `output: 'standalone'` (route: `ƒ /`, `○ /_not-found`, `ƒ /api/v1/health`); da ripetere dal lead dopo l'aggiunta di `error.tsx`, `instrumentation.ts` e `?probe=dependencies`.
- [x] M0-T11-S06 Commit per task sostituito dal commit unico `feat(setup): bootstrap Next.js, fix gitattributes e architettura iniziale` (vedi M0-T06-S07); spuntare con l'hash.

### M0-T12 — Documentazione di bootstrap
- [ ] M0-T12-S01 `README.md`: avvio (`npm install`, `npm run dev`), variabili env, vincolo processo singolo (mai serverless/multi-istanza in fase mock), tabella "ultima cifra telefono → esito" dei mock, credenziali demo.
- [ ] M0-T12-S02 `docs/GLOSSARIO.md` generato da `src/domain/glossary.ts` con script `scripts/gen-glossary.mts` (aggiunto a `npm run docs`).
- [ ] M0-T12-S03 `docs/adr/ADR-001..014.md` (un file per decisione, template: contesto, decisione, motivazione, alternative, conseguenze); aggiornare i rimandi in `ARCHITECTURE.md` (§ intestazione) e in questo file.
- [ ] M0-T12-S03b Pulizia del markdown "escapato" in `CLAUDE.md` e `docs/ANALISI_REQUISITI.md` (`\#`, `\*\*`, `\-`, `&#x20;` → markdown normale, refuso «Visone Generale» → «Visione Generale»), senza modificare il contenuto delle regole; verificare il rendering su GitHub.
- [ ] M0-T12-S04 Allineare `ARCHITECTURE.md` ed `src/README.md` alle eventuali deviazioni emerse in M0-T06..T11.
- [ ] M0-T12-S05 Commit `docs(M0-T12): README, glossario e ADR`.

### M0-T13 — Continuous Integration
- [ ] M0-T13-S01 `.github/workflows/ci.yml`: trigger push/PR su `main`, Node 24, npm con cache (`actions/setup-node` con `cache: npm`), passi `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- [ ] M0-T13-S02 Badge CI nel `README.md`.
- [ ] M0-T13-S02b Protezione del branch `main` (PR obbligatoria, CI verde richiesta) attivata nelle impostazioni del repository e documentata nella sezione «Flusso di lavoro Git» del `README.md` (branch `feature/M<n>-<slug>`, commit atomici, nessun push diretto su `main`).
- [ ] M0-T13-S03 Commit `ci(M0-T13): pipeline GitHub Actions`.

---

## M1 — P1 · Core System e Dashboard Accettazione (Web App Operatore)

- **Priorità**: P1.
- **Obiettivo**: login accettatore, vista multi-postazione con filtro Brand/Sportello e sblocco vista globale, lista ordinata per orario con codici F001…, azioni Prendi in carico / Salta / Completato / Rilascia / No-show con state machine e assegnazione campata, sync finta delle 06:00 (manuale + scheduler), fallback inserimento manuale, aggiornamento in tempo reale via polling, stato condiviso server-side con snapshot.
- **Criteri di completamento**: due browser (due postazioni) vedono la stessa coda entro 3 s; F001 è la prima prenotazione della giornata; prendere in carico la stessa pratica da due postazioni produce `409` con `ConflictDialog`; con `MOCK_INFINITY_MODE=error` la dashboard mostra il `SyncBanner` e permette l'inserimento manuale con codice corretto dallo stesso contatore; un riavvio del server ripristina la coda da `.data/state.json`; e2e smoke verde; tutti i test verdi.
- **Dipendenze**: M0 completo.

### M1-T01 — Pianificazione del modulo A e fixture
- [ ] M1-T01-S01 Rileggere `docs/ANALISI_REQUISITI.md` §A e `ARCHITECTURE.md`; annotare qui le decisioni prese sulle domande aperte n. 1, 3, 7 (default: `CODE_SEQUENCE_SCOPE=SITE`, campata proposta = `Workstation.defaultBayId` modificabile, Salta = resta al proprio orario evidenziata).
- [ ] M1-T01-S02 `tests/fixtures/agenda-2026-09-10.json` e `agenda-vuota.json`: agende congelate generate da `InfinityServiceMock` per asserzioni deterministiche.
- [ ] M1-T01-S03 Branch `feature/M1-core-dashboard`; commit `docs(M1-T01): pianificazione modulo A e fixture agenda`.

### M1-T02 — CodeGenerator (application/queue)
Assegnazione del codice progressivo F001… come identità immutabile.
- [ ] M1-T02-S01 `src/application/queue/CodeGenerator.ts`: `assign(input: { businessDate, brand }): Promise<QueueCode & { sequence }>` che usa `IAppointmentRepository.reserveNextSequence(businessDate, prefix)` + `formatQueueCode`.
- [ ] M1-T02-S02 Strategie `SITE` (prefisso `CODE_PREFIX`, un contatore per giornata) e `BRAND` (`Brand.codePrefix`, un contatore per brand e giornata) selezionate da `env.codeSequenceScope`.
- [ ] M1-T02-S03 Test `tests/unit/code-generator.test.ts`: F001, F002…, cambio giornata azzera, nessun riutilizzo dopo `CANCELLED`, strategia BRAND (F001/J001), overflow F1000.
- [ ] M1-T02-S04 Commit `feat(M1-T02): CodeGenerator con strategia SITE|BRAND`.

### M1-T03 — QueueService: letture e transizioni di stato
Cuore del modulo A; dipende solo da interfacce.
- [ ] M1-T03-S01 `src/application/queue/QueueService.ts` con deps `{ appointments, referenceData, operators, crmOutbox, eventBus, clock, ids, logger, codeGenerator, env }`; tipo `QueueQuery { businessDate; deskId: DeskId | null; globalView: boolean }`.
- [ ] M1-T03-S02 `getQueue(query): Promise<readonly QueueRowView[]>`: `listByDate` ordinata per (scheduledAt, sequence), filtro per `deskId`/brand dello sportello se `!globalView`, arricchimento `operatorName` e `bayCode`.
- [ ] M1-T03-S03 `takeInCharge({ appointmentId, operatorId, workstationId, bayId, expectedVersion })`: `assertTransition(WAITING|SKIPPED → IN_PROGRESS)`, invariante "una sola IN_PROGRESS per bayId" (→ `BAY_BUSY` con elenco campate libere in `details`), set `bayId`, `operatorId`, `takenAt`, `repo.update(expectedVersion)` → `VERSION_CONFLICT` con la pratica aggiornata in `details`.
- [ ] M1-T03-S04 `skip({ appointmentId, operatorId, expectedVersion })`: → `SKIPPED`, `skipCount + 1`, `skippedAt`; la pratica resta al proprio orario (ordinamento invariato) ed è evidenziata; commento sulla regola configurabile futura.
- [ ] M1-T03-S05 `complete(...)`: `IN_PROGRESS → COMPLETED`, `completedAt`, libera la campata (derivata, nessun campo su `Bay`).
- [ ] M1-T03-S06 `release(...)`: `IN_PROGRESS → WAITING`, azzera `bayId`/`operatorId` (annulla presa in carico errata).
- [ ] M1-T03-S06b `restore({ appointmentId, operatorId, expectedVersion })`: `SKIPPED → WAITING` ("Ripristina"), azzera `skippedAt` lasciando `skipCount` invariato (serve all'anomalia EXCESSIVE_SKIPS).
- [ ] M1-T03-S07 `markNoShow({ appointmentId, operatorId, expectedVersion, reason })`: `WAITING|SKIPPED → NO_SHOW`, `noShowAt`, scrittura `CrmOutboxEvent { type: 'NO_SHOW', status: 'PENDING' }` con `idempotencyKey = buildNoShowIdempotencyKey(appointment)` (`${appointmentId}:NO_SHOW:${businessDate}`, helper già in `services/mappers/crm.mapper.ts`); `reopenNoShow` (`NO_SHOW → WAITING`) riservato a `SUPERVISOR|ADMIN` (ruolo riverificato).
- [ ] M1-T03-S08 Pubblicazione `APPOINTMENT_STATUS_CHANGED` (con `actor OPERATOR`, `correlationId`) su ogni transizione riuscita; log info in italiano.
- [ ] M1-T03-S09 *(annullato: anticipava P2/P4 dentro P1; `getPublicPositionByPlate` è ora M2-T03-S01 e `getBayDisplay` è M4-T02-S01, unici proprietari delle rispettive regole)*.
- [ ] M1-T03-S09b `getBayOccupancy(businessDate)`: per ogni campata attiva la pratica `IN_PROGRESS` che la occupa (o `null`), derivata da `Appointment.bayId + status`; serve all'invariante di `takeInCharge` e a `BaySelectDialog` (M1-T13-S02). Nessuno stato di display (RELEASING/OFFLINE: M4).
- [ ] M1-T03-S10 Test `tests/unit/queue-service.test.ts`: ogni transizione consentita/vietata (incluse `restore` e `reopenNoShow` con ruolo), `BAY_BUSY`, `VERSION_CONFLICT`, evento pubblicato, outbox NO_SHOW scritta con la chiave corretta, filtro sportello vs vista globale, `getBayOccupancy`.
- [ ] M1-T03-S11 Commit `feat(M1-T03): QueueService con state machine, versioning e invariante campata`.

### M1-T04 — Inserimento manuale pratica (fallback Infinity)
- [ ] M1-T04-S01 `QueueService.addManualAppointment(input: ManualAppointmentInput, operatorId)`: validazione targa/telefono con i value object, `source: 'MANUAL'`, `externalRef: null`, codice dal `CodeGenerator` (stesso contatore della sync), `insert` con propagazione del `Result` (`VALIDATION` su duplicato), evento `APPOINTMENT_CREATED` e `APPOINTMENT_CODE_ASSIGNED`.
- [ ] M1-T04-S02 Duplicati: stessa targa già presente oggi → `VALIDATION` con messaggio "Targa già presente nell'agenda di oggi (codice F0xx)" e possibilità di forzare (`allowDuplicate`).
- [ ] M1-T04-S03 Test: codice progressivo coerente con la sync successiva (manuale F001, poi sync assegna F002…), pratiche MANUAL mai toccate dalla reconciliation.
- [ ] M1-T04-S04 Commit `feat(M1-T04): inserimento manuale pratica con codice dal contatore condiviso`.

### M1-T05 — SyncService: sincronizzazione idempotente e non distruttiva
- [ ] M1-T05-S01 `src/application/sync/SyncService.ts`: `runDailySync(businessDate, trigger, operatorId?): Promise<SyncRun>`; crea `SyncRun RUNNING`, chiama `infinity.fetchDailyAgenda` con `CallOptions { timeoutMs: 10000, correlationId }`, mappa con `mapInfinityAgenda` (restituisce `Result`: agenda con `businessDate` non valida → `SyncRun FAILED`, nessuna pratica creata), poi `reconcile`.
- [ ] M1-T05-S02 `reconcile(drafts, rejected, syncRunId)`: upsert per `externalRef`; nuove pratiche ordinate per (`scheduledAt`, `externalRef`) e codificate via `CodeGenerator`, inserite con `IAppointmentRepository.insert` (che restituisce `Result`: un duplicato → conteggiato in `rejected`, mai sovrascritto); aggiornamento dati cliente/veicolo/orario delle esistenti senza regressione di stato; annullate in Infinity → `CANCELLED` solo se `WAITING|SKIPPED`; mai delete, mai rinumerazione; `counters` popolati.
- [ ] M1-T05-S03 Esiti: agenda `partial=true` → `SyncRun PARTIAL`; `ProviderResult` err → `SyncRun FAILED` con `errorCode`/`errorMessage`; `rejected` > 0 → PARTIAL con dettaglio; evento `SYNC_RUN_FINISHED`.
- [ ] M1-T05-S04 Lock in-process (`Promise` memorizzata per `businessDate`) contro sync concorrenti: la seconda chiamata riceve la stessa `SyncRun`.
- [ ] M1-T05-S05 Test `tests/unit/sync-service.test.ts` con fixture: prima sync crea N pratiche con F001…; seconda sync identica → `unchanged = N`; pratica sparita mentre `IN_PROGRESS` resta invariata; `cancelled=true` su WAITING → CANCELLED; modalità `error`/`partial`/`timeout` del mock; lock.
- [ ] M1-T05-S06 Commit `feat(M1-T05): SyncService idempotente con reconciliation`.

### M1-T06 — SyncScheduler, bootstrap e snapshot dello stato
- [ ] M1-T06-S01 `src/application/sync/SyncScheduler.ts`: `tick()` ogni 30 s che esegue `runDailySync(today, 'SCHEDULED')` la prima volta in cui l'ora locale Europe/Rome supera `SYNC_HOUR_LOCAL` per una `businessDate` senza `SyncRun` SUCCESS/PARTIAL (catch-up dopo riavvio); `start()`/`stop()`; guard su `globalThis.__accettazioneScheduler` (un solo scheduler anche con HMR).
- [ ] M1-T06-S02 `src/instrumentation.ts` (`register()` solo su runtime `nodejs`; il file esiste dal bootstrap e chiama già `getContainer()` per il fail-fast all'avvio): ripristino snapshot, `runDailySync(today, 'BOOTSTRAP')` se la giornata non è sincronizzata, avvio scheduler; stesso bootstrap idempotente alla prima richiesta che chiama `getContainer()`.
- [ ] M1-T06-S03 `src/repositories/in-memory/SnapshotPersistence.ts` (importato solo da `repositories/factory.ts`): `InMemoryStore.toSnapshot()` → scrittura debounced (2 s) atomica `tmp + rename` in `.data/state.json`; `loadSnapshot` validato con Zod all'avvio.
- [ ] M1-T06-S03b Rotazione e ripristino: prima di ogni scrittura `state.json` → `state.prev.json`; alla chiusura giornata archivio `.data/archive/<businessDate>.json`; all'avvio principale invalido → ripristino da `prev` (log warn); entrambi invalidi → log error, si parte vuoti, sync immediata, banner. Test `tests/unit/snapshot-persistence.test.ts` (round-trip, principale corrotto → `prev`, entrambi corrotti). La procedura manuale va nel `RUNBOOK_OPERATIVO.md` (M6-T06-S01).
- [ ] M1-T06-S04 Test `tests/unit/sync-scheduler.test.ts` con `FixedClock`: nessuna sync alle 05:59, una sola sync dopo le 06:00, catch-up avviando alle 09:00, cambio ora legale (ultima domenica di marzo/ottobre).
- [ ] M1-T06-S05 Commit `feat(M1-T06): scheduler con catch-up, bootstrap e snapshot atomico`.

### M1-T07 — Autenticazione locale (mock auth) e protezione rotte
- [ ] M1-T07-S01 `src/application/auth/IAuthService.ts`: `login(username, password, workstationId): Promise<Result<Session, DomainError>>`, `verify(token): Promise<Result<Session, DomainError>>`, `logout(token)`; `Session { operatorId; role; displayName; workstationId; deskIds; expiresAt }`.
- [ ] M1-T07-S02a `src/lib/hash-password.ts`: `hashPassword(plain)` / `verifyPassword(plain, hash)` con `scrypt` di `node:crypto` (sale casuale, confronto a tempo costante, formato `scrypt$<params>$<salt>$<hash>`); test `tests/unit/hash-password.test.ts`.
- [ ] M1-T07-S02b `src/application/auth/LocalAuthService.ts` — `login`: `IOperatorRepository.findByUsername`, `verifyPassword`, utente disattivato o password errata → stesso messaggio generico "Credenziali non valide" (nessuna enumerazione utenti).
- [ ] M1-T07-S02c `LocalAuthService` — emissione e verifica JWT HS256 con `jose` (`SESSION_SECRET`, scadenza 8 h, claim `operatorId`, `role`, `workstationId`, `deskIds`); `verify` → `Result` con `NOT_FOUND`/`VALIDATION` su token scaduto o manomesso.
- [ ] M1-T07-S02d Validazione di `SESSION_SECRET` all'avvio in `config/env.ts`/`container.ts`: lunghezza minima 32 caratteri; il valore di default di `.env.example` è accettato solo con tutti i provider `mock` e `NODE_ENV != production`, altrimenti `ConfigurationError` (fail-fast).
- [ ] M1-T07-S03 Aggiornare `config/seed.ts`: password demo con hash scrypt reale generato da `scripts/seed-passwords.mts`; rimuovere `plain:demo` (il guard `hasDemoCredentials` del container resta come rete di sicurezza); credenziali demo documentate nel README.
- [ ] M1-T07-S04 Route Handler `POST /api/v1/auth/login` (body Zod `{ username, password, workstationId }`, cookie `HttpOnly; SameSite=Lax; Secure` in produzione) e `POST /api/v1/auth/logout`; `GET /api/v1/auth/me` per la shell; `GET /api/v1/auth/workstations` (elenco postazioni per il form di login, anonimo ma sotto `auth/`, non `public/`).
- [ ] M1-T07-S04b Rate limit del login con `lib/http/rate-limit.ts` (M1-T08-S02): 5 tentativi/min per coppia IP+username → `429` con `Retry-After`, log warn con IP mascherato; test `tests/unit/http/auth-login.test.ts` (sesto tentativo → 429, finestra scaduta → 200).
- [ ] M1-T07-S05 `src/proxy.ts` (ex middleware, Next 16): protegge `(operator)/**` e `/api/v1/**` tranne `/api/v1/public/**`, `/api/v1/auth/**`, `/api/v1/health`, `/api/v1/sync` (`SYNC_SECRET`), `/api/v1/webhooks/**`; redirect a `/login?next=`; propagazione `x-correlation-id`.
- [ ] M1-T07-S06 Test unit `LocalAuthService` (login ok, password errata, utente disattivato, token scaduto) e test `proxy` sulle regole di matching.
- [ ] M1-T07-S07 Commit `feat(M1-T07): autenticazione locale con JWT e guard delle rotte`.

### M1-T08 — Helper HTTP e Route Handler della coda
- [ ] M1-T08-S01 `src/lib/http/respond.ts`: `jsonOk`, `jsonError`, mappatura `DomainError → HTTP` (`NOT_FOUND` 404, `VERSION_CONFLICT`/`BAY_BUSY` 409, `INVALID_TRANSITION`/`VALIDATION` 422, `INTERNAL` 500) con corpo `{ error: { code, message, details } }` e `x-correlation-id`.
- [ ] M1-T08-S02 `src/lib/http/with-auth.ts` (sessione + ruolo minimo; `/api/v1/system/**` richiede ADMIN), `with-validation.ts` (Zod su query/body, 400 con dettagli), `idempotency.ts` (cache in memoria per `Idempotency-Key` con TTL 10 min: stessa chiave → stessa risposta), `rate-limit.ts` (finestra scorrevole in memoria per chiave arbitraria, riusato dal login in M1-T07-S04b e dal portale in M2-T02-S02).
- [ ] M1-T08-S02b `src/lib/http/with-logging.ts`: log strutturato per richiesta (metodo, path, status, durata ms, `correlationId`, `operatorId`, `action`, esito/`errorCode`) tramite `ILogger`; è l'audit trail di "chi ha preso in carico cosa"; test `tests/unit/http/with-logging.test.ts` con `NoopLogger` spia. Il formato JSON (`JsonConsoleLogger`/pino) arriva in M6-T05-S03b.
- [ ] M1-T08-S03 `GET /api/v1/queue?date=&deskId=&view=desk|global` → `{ rows: QueueRowView[]; lastSync: SyncRun | null; serverTime }`.
- [ ] M1-T08-S04 `POST /api/v1/appointments` (inserimento manuale, Zod `ManualAppointmentInput`).
- [ ] M1-T08-S05 `POST /api/v1/appointments/[id]/actions` con body `{ action: 'take'|'skip'|'complete'|'release'|'restore'|'no-show'|'reopen', expectedVersion, bayId?, workstationId?, reason? }` (`restore` = SKIPPED → WAITING; `reopen` = NO_SHOW → WAITING, SUPERVISOR/ADMIN), header `Idempotency-Key` obbligatorio; `409` restituisce la pratica aggiornata.
- [ ] M1-T08-S06 `POST /api/v1/sync` (sessione ADMIN oppure header `x-sync-secret`), `GET /api/v1/sync?limit=` (ultime `SyncRun`).
- [ ] M1-T08-S07 Test `tests/unit/http/*.test.ts` sui Route Handler con `Request` nativa: 401 senza sessione, 400 body invalido, 409 conflitto, idempotenza (doppio POST stessa chiave → una sola transizione).
- [ ] M1-T08-S08 Commit `feat(M1-T08): Route Handler coda, azioni, inserimento manuale e sync`.

### M1-T09 — Client API, hook e store delle preferenze UI
- [ ] M1-T09-S01 `src/lib/api-client/client.ts` (fetch tipizzato con `zod` sulle risposte, `AbortSignal.timeout(8000)`, header `Idempotency-Key` con `crypto.randomUUID()`) e `query-keys.ts` (`queueKeys.list(date, deskId, view)`, `syncKeys.recent`).
- [ ] M1-T09-S02 `src/hooks/useQueue.ts`: `useQuery` con `refetchInterval: POLLING_MS.dashboard`, `refetchIntervalInBackground`, espone `dataUpdatedAt` e `isStale`.
- [ ] M1-T09-S03 `src/hooks/useAppointmentActions.ts`: `useMutation` pessimistiche (`take`, `skip`, `complete`, `release`, `noShow`) con invalidazione della coda, gestione `409` → callback `onConflict(appointment)`, `BAY_BUSY` → `onBayBusy(freeBays)`, timeout → toast "Riprova".
- [ ] M1-T09-S04 `src/hooks/useStaleIndicator.ts`: `true` se `now - dataUpdatedAt > STALE_WARNING_MS`.
- [ ] M1-T09-S05 `src/store/ui-store.ts` (zustand `persist`): `workstationId`, `globalView`, `brandFilter`, `deskFilter`, `compactRows`; nessun dato di coda nello store.
- [ ] M1-T09-S06 Test hook con Testing Library e `QueryClient` di test (mock `fetch`): `tests/components/use-queue.test.tsx` (polling, `isStale`), `tests/components/use-appointment-actions.test.tsx` (409 → `onConflict`, `BAY_BUSY` → `onBayBusy`, timeout → toast), `tests/unit/ui-store.test.ts` (persistenza preferenze, nessun dato di coda).
- [ ] M1-T09-S07 Commit `feat(M1-T09): client API tipizzato, hook useQueue/useAppointmentActions e store UI`.

### M1-T10 — Pagina di login e scelta postazione
- [ ] M1-T10-S01 `src/app/(auth)/login/page.tsx` + `modules/reception/LoginForm.tsx`: username, password, `Select` postazione (da `GET /api/v1/auth/workstations`, M1-T07-S04, o props del Server Component), errore in italiano, gestione del focus, `Enter` per inviare.
- [ ] M1-T10-S02 Redirect post-login a `/accettazione` (o a `next=`); `src/app/page.tsx` reindirizza a `/accettazione` se sessione valida, altrimenti `/login` (sostituisce la pagina di verifica dell'health del bootstrap). Decidere qui l'attivazione di `typedRoutes: true` in `next.config.ts` (rinviata da M0-T06-S05): verificare che `Link`/`redirect()` restino verdi con `npm run typecheck` e `npm run build`.
- [ ] M1-T10-S03 Test componente `LoginForm` (validazione campi, messaggio errore) e e2e login riuscito/fallito.
- [ ] M1-T10-S04 Commit `feat(M1-T10): pagina login con scelta postazione`.

### M1-T11 — Shell operatore e vista multi-postazione
- [ ] M1-T11-S01 `src/app/(operator)/layout.tsx` + `components/layout/AppShell.tsx`, `Header.tsx` (nome operatore, postazione corrente, orologio Europe/Rome, logout), `StaleDataIndicator`, `SystemStatusBanner` (placeholder alimentato da `/api/v1/health` da M6).
- [ ] M1-T11-S02 `modules/reception/WorkstationSwitcher.tsx`: cambio postazione senza logout (aggiorna sessione via `POST /api/v1/auth/workstation` e store).
- [ ] M1-T11-S03 `modules/reception/DeskBrandFilter.tsx`: filtro predefinito sullo sportello della postazione, chip dei brand dello sportello; `GlobalViewToggle.tsx` "Vista globale" che rimuove il filtro (persistito nello store, indicato nell'header con badge).
- [ ] M1-T11-S04 Filtri nei search param dell'URL (`?date=&deskId=&view=`) sincronizzati con lo store, così un link è condivisibile fra postazioni.
- [ ] M1-T11-S05 Test componente: toggle vista globale aggiorna query key e URL.
- [ ] M1-T11-S06 Commit `feat(M1-T11): shell operatore, switch postazione e vista globale`.

### M1-T12 — Tabella della coda
- [ ] M1-T12-S01 `src/app/(operator)/accettazione/page.tsx` (Server Component: primo render con `getContainer().queueService.getQueue()`, idratazione della cache TanStack) + `modules/reception/QueueTable.tsx` (client, `useQueue`).
- [ ] M1-T12-S02a `AppointmentRow.tsx`: colonne codice (monospace, grande), orario prenotazione, targa, brand/modello, cliente (cognome nome), sportello, stato, campata, operatore, azioni (slot per `ActionButtons`); test `tests/components/appointment-row.test.tsx` sul rendering delle colonne.
- [ ] M1-T12-S02b `AppointmentRow.tsx` — evidenze: riga `SKIPPED` evidenziata; badge `MANUAL` per le pratiche inserite a mano; tooltip "aggiunta successivamente" quando `sequence` non è monotona rispetto all'orario (helper puro `isOutOfSequence(rows)` in `modules/reception/queue-rows.ts` con test unit).
- [ ] M1-T12-S03 `StatusBadge.tsx` con token colore per i sei stati e testo italiano (In attesa, In carico, Saltata, Completata, No-show, Annullata).
- [ ] M1-T12-S04 Sezioni/ordinamento: in attesa e saltate per (orario, sequenza); in carico in evidenza in alto; completate/no-show/annullate in una sezione collassabile "Chiuse oggi" (default nascoste dopo 15 min).
- [ ] M1-T12-S05 `components/shared/EmptyState.tsx` ("Nessuna pratica per oggi", con CTA "Sincronizza ora"/"Inserisci pratica") ed `ErrorBoundary.tsx` per modulo.
- [ ] M1-T12-S06 Test componente `QueueTable` con righe fixture: ordinamento, badge, sezione chiuse.
- [ ] M1-T12-S07 Commit `feat(M1-T12): QueueTable con righe, badge di stato e sezioni`.

### M1-T13 — Pulsanti azione, assegnazione campata e conflitti
- [ ] M1-T13-S01 `modules/reception/ActionButtons.tsx`: pulsanti visibili in base a `ALLOWED_TRANSITIONS` (Prendi in carico, Salta, Ripristina, Completato, Rilascia, No-show; Riapri solo per SUPERVISOR/ADMIN); mai disabilitati da guasti esterni, solo dalle regole di transizione; stato pessimistico con spinner, timeout 8 s e "Riprova"; target touch 48 px.
- [ ] M1-T13-S02 `BaySelectDialog.tsx`: alla presa in carico propone `Workstation.defaultBayId`, mostra le 4 campate con occupazione derivata (codice in servizio), consente "Assegna campata manualmente"; presa in carico diretta con un solo click se la campata predefinita è libera.
- [ ] M1-T13-S03 `ConflictDialog.tsx`: su `409 VERSION_CONFLICT` mostra "Presa in carico da {operatore} alla postazione {P}" con la pratica aggiornata e pulsante "Aggiorna"; su `BAY_BUSY` propone le campate libere.
- [ ] M1-T13-S04 Conferma per azioni con effetti esterni (`No-show` chiede motivazione; `Rilascia` conferma); `Salta` immediato.
- [ ] M1-T13-S05 Test `tests/components/action-buttons.test.tsx` (pulsanti corretti per ogni stato e ruolo), `tests/components/conflict-dialog.test.tsx` (409 simulato → dialog con pratica aggiornata), `tests/components/bay-select-dialog.test.tsx` (campata predefinita, occupazione derivata); idempotenza del doppio click in `tests/components/use-appointment-actions.test.tsx` (M1-T09-S06).
- [ ] M1-T13-S06 Commit `feat(M1-T13): azioni pessimistiche, scelta campata e ConflictDialog`.

### M1-T14 — Banner sync e fallback inserimento manuale in UI
- [ ] M1-T14-S01 `modules/reception/SyncBanner.tsx`: legge `lastSync` dalla risposta di `/api/v1/queue`; `FAILED` → rosso con "Riprova sync" e "Inserisci pratica manualmente"; `PARTIAL` → giallo con conteggio scartati; `RUNNING` → indicatore; nessuna sync oggi → avviso con CTA.
- [ ] M1-T14-S02a Schema Zod `ManualAppointmentInput` condiviso client/server in `modules/reception/manual-appointment.schema.ts` (targa via `parsePlate`, telefono opzionale via `parsePhoneE164`, brand, modello, cognome/nome, orario prenotazione, sportello, note) con messaggi in italiano; test `tests/unit/manual-appointment-schema.test.ts`.
- [ ] M1-T14-S02b `ManualAppointmentForm.tsx` in `src/app/(operator)/accettazione/nuova/page.tsx`: campi con maiuscola automatica sulla targa, select brand/sportello, orario predefinito "adesso", errori inline dallo schema; invio a `POST /api/v1/appointments`.
- [ ] M1-T14-S02c Esito dell'inserimento: schermata con codice assegnato in grande, link alla coda e "Inserisci un'altra pratica"; gestione del `VALIDATION` "targa già presente" con opzione `allowDuplicate` (M1-T04-S02).
- [ ] M1-T14-S03 Pulsante "Sincronizza ora" nell'header per ADMIN/SUPERVISOR (→ `POST /api/v1/sync`) con toast dell'esito e counters.
- [ ] M1-T14-S04 Test `tests/components/manual-appointment-form.test.tsx` (validazioni, messaggi) e `tests/e2e/sync-fallback.spec.ts`: con `MOCK_INFINITY_MODE=error` compare il banner e l'inserimento manuale produce F001.
- [ ] M1-T14-S05 Commit `feat(M1-T14): SyncBanner e inserimento manuale pratica`.

### M1-T15 — Dettaglio pratica, storico e pagina Sistema
- [ ] M1-T15-S01 `src/app/(operator)/accettazione/pratiche/[id]/page.tsx`: dati pratica, cliente, veicolo, timeline dagli eventi del bus (`IEventBus.listSince(0)` filtrati per `appointmentId`; decisione: in M1 nessuna cronologia persistita, la timeline copre gli eventi in memoria del processo; la cronologia persistita è nel backlog), note modificabili, azioni.
- [ ] M1-T15-S02 `GET /api/v1/appointments/[id]` e `PATCH /api/v1/appointments/[id]/notes`.
- [ ] M1-T15-S03 `src/app/(operator)/sistema/page.tsx` (ADMIN): ultime 20 `SyncRun` con counters, "Sincronizza ora", modalità mock attive (`env.mock*`), stato snapshot (ultimo salvataggio), versione build.
- [ ] M1-T15-S04 Test e2e navigazione riga → dettaglio; test accesso `/sistema` negato ad ADVISOR (403).
- [ ] M1-T15-S05 Commit `feat(M1-T15): dettaglio pratica e pagina Sistema`.

### M1-T16 — Accessibilità e usabilità monopagina
- [ ] M1-T16-S01a Scorciatoie da tastiera in `modules/reception/useQueueShortcuts.ts` (frecce per navigare le righe, `P` prendi in carico, `S` salta, `C` completato) con focus visibile sulla riga selezionata; test `tests/components/use-queue-shortcuts.test.tsx`.
- [ ] M1-T16-S01b Legenda scorciatoie (`?` apre `ShortcutsHelpDialog.tsx`) e regione `aria-live="polite"` per aggiornamenti della coda e toast (`components/shared/LiveAnnouncer.tsx`).
- [ ] M1-T16-S02a Contrasto dei badge di stato verificato con axe-core (`@axe-core/playwright`): 0 violazioni `color-contrast` (AA) sulla dashboard con tutti i sei stati presenti.
- [ ] M1-T16-S02b Modalità "righe compatte" (store UI) e verifica layout: nessuno scroll orizzontale a 1366×768 e con zoom 125 % (test Playwright con `viewport` e `deviceScaleFactor`).
- [ ] M1-T16-S03 `components/shared/OfflineBanner.tsx` (evento `offline`/poll falliti): "Connessione al server assente, dati non aggiornati da N s", azioni comunque tentabili con "Riprova".
- [ ] M1-T16-S04 Audit con axe (`@axe-core/playwright`) sulla dashboard: nessuna violazione critica.
- [ ] M1-T16-S05 Commit `feat(M1-T16): accessibilità, scorciatoie e banner offline`.

### M1-T17 — Test di contratto ed e2e del modulo A
- [ ] M1-T17-S01 `tests/contracts/infinity-service.contract.ts` (`runInfinityServiceContract(label, factory)`): mai throw, `Result.err` in `error`/`timeout`, rispetto di `signal`, forma DTO valida (Zod), determinismo per `businessDate`, `healthCheck` (rispetta `timeoutMs`/`signal` di `CallOptions`: oggi i mock li ignorano e `check-health.ts` applica un timer locale di 2000 ms); eseguita su `InfinityServiceMock`.
- [ ] M1-T17-S02 `tests/contracts/appointment-repository.contract.ts`: ordinamento, `VERSION_CONFLICT`, `reserveNextSequence` mai riutilizzato, `countAhead` per scope; eseguita su `InMemoryAppointmentRepository` (Prisma in M7).
- [ ] M1-T17-S03 `playwright.config.ts` + `tests/e2e/smoke.spec.ts`: login → coda con F001 → prendi in carico (campata C1) → completato; `tests/e2e/conflict.spec.ts`: due contesti browser, stessa pratica → `ConflictDialog`.
- [ ] M1-T17-S04 Script `test:e2e` in CI con server avviato in modalità mock e `FixedClock` via env `MOCK_FIXED_NOW`.
- [ ] M1-T17-S05 Commit `test(M1-T17): contract suite Infinity/repository ed e2e smoke`.

### M1-T18 — Documentazione e chiusura M1
- [ ] M1-T18-S01 Aggiornare `README.md` (flusso operatore, credenziali demo, interruttori mock utili per la demo), `ARCHITECTURE.md` e `docs/GLOSSARIO.md`; ADR nuovi se emerse deviazioni (es. semantica di Salta).
- [ ] M1-T18-S02 Verifica dei criteri di completamento di M1 con checklist manuale (due browser, riavvio server, `MOCK_INFINITY_MODE=error`) annotata qui.
- [ ] M1-T18-S03 Aggiornare `TASKS.md`, PR `feature/M1-core-dashboard` → `main`; commit `docs(M1-T18): chiusura milestone M1`.

---

## M2 — P2 · Portale Web Cliente (QR Code e stato)

- **Priorità**: P2.
- **Obiettivo**: landing responsive raggiunta da QR code, ricerca per targa con validazione, esito con codice assegnato e numero di clienti in attesa prima del cliente, gestione targa non trovata, anti-abuso e privacy (nessun dato personale).
- **Criteri di completamento**: da smartphone, inquadrando il QR e digitando una targa dell'agenda mock, si vedono codice e "clienti prima di te" aggiornati entro 5 s dopo un'azione dell'operatore; la risposta di `/api/v1/public/status` non contiene nomi, telefoni o modelli; targa sconosciuta e server irraggiungibile mostrano messaggi chiari; rate limit attivo; accessibilità mobile verificata (axe-core a 375×812 senza violazioni critiche, contrasto AAA sul codice, target ≥ 48 px); test verdi.
- **Dipendenze**: M1 (`QueueService`, `IAppointmentRepository.countAhead`, stato condiviso).

### M2-T01 — Pianificazione modulo B
- [ ] M2-T01-S01 Decidere e annotare qui le regole di default per le domande aperte n. 5 e 6 (`QUEUE_AHEAD_SCOPE=SITE`, SKIPPED contate come in attesa, sola targa con rate limit; secondo fattore in backlog).
- [ ] M2-T01-S02 Branch `feature/M2-portale-cliente`; commit `docs(M2-T01): pianificazione modulo B`.

### M2-T02 — API pubblica di stato con rate limit
- [ ] M2-T02-S01 `GET /api/v1/public/status?plate=`: `normalizePlate` + `parsePlate` (422 "Formato targa non valido"), `getPublicPositionByPlate(plate, today)` → `QueuePositionView`; 404 con messaggio "Targa non trovata nell'agenda di oggi. Rivolgiti allo sportello."; `Cache-Control: no-store`.
- [ ] M2-T02-S02 `src/lib/http/rate-limit.ts`: sliding window in memoria per IP (es. 30 richieste/min) e per targa (10/min) → 429 con `Retry-After`; esclusione degli IP interni configurabile (`RATE_LIMIT_ALLOWLIST`).
- [ ] M2-T02-S03 Pratiche `CANCELLED`/`COMPLETED`: risposta con stato e messaggio dedicato ("Accettazione completata", "Appuntamento annullato: rivolgiti allo sportello").
- [ ] M2-T02-S04 Test unit: normalizzazione targhe (`ab 123 cd` → `AB123CD`), 404, 429, assenza di campi personali (snapshot della forma JSON).
- [ ] M2-T02-S05 Commit `feat(M2-T02): endpoint pubblico di stato con rate limit`.

### M2-T03 — Regola "clienti prima di te"
- [ ] M2-T03-S01 `QueueService.getPublicPositionByPlate(plate, businessDate)` → `QueuePositionView` (unico proprietario della regola "clienti prima di te", spostato qui da M1-T03-S09): usa `IAppointmentRepository.countAhead(appointment, scope)` con `QUEUE_AHEAD_SCOPE=DESK|SITE` e flag `QUEUE_AHEAD_INCLUDE_SKIPPED` (default true) letto in `env.ts` e passato al repository; documentare in README.
- [ ] M2-T03-S02 `aheadCount` = 0 e `bayNumber` quando `IN_PROGRESS` ("È il tuo turno: campata N").
- [ ] M2-T03-S03 Test unit `tests/unit/queue-position.test.ts`: `countAhead` su fixture con SKIPPED incluse/escluse, sportelli diversi, pratiche chiuse; nessun campo personale nella view.
- [ ] M2-T03-S04 Commit `feat(M2-T03): regola configurabile del conteggio in attesa`.

### M2-T04 — UI portale: ricerca targa
- [ ] M2-T04-S01 `src/app/(public)/layout.tsx` (mobile-first, logo neutro, nessuna navigazione operatore) e `src/app/(public)/cliente/page.tsx`.
- [ ] M2-T04-S02 `modules/customer-portal/PlateSearchForm.tsx`: input con `autocapitalize="characters"`, `inputmode`, formattazione live, validazione client con `parsePlate`, pulsante grande, messaggi in italiano; invio → `/cliente/stato?targa=`.
- [ ] M2-T04-S03 Informativa breve privacy (testo placeholder da validare col PO) e link "Non trovi la tua targa? Rivolgiti allo sportello".
- [ ] M2-T04-S04 Test `tests/components/plate-search-form.test.tsx`: validazione, formattazione live, navigazione a `/cliente/stato?targa=`.
- [ ] M2-T04-S05 Commit `feat(M2-T04): form ricerca targa mobile-first`.

### M2-T05 — UI portale: esito e stato in tempo reale
- [ ] M2-T05-S01 `src/hooks/usePublicStatus.ts`: `useQuery` con `refetchInterval: POLLING_MS.portal`, retry limitato, `retryOnMount`.
- [ ] M2-T05-S02 `modules/customer-portal/QueuePositionCard.tsx`: codice enorme, "Clienti prima di te: N", stato leggibile, campata quando in carico, ora ultimo aggiornamento; `src/app/(public)/cliente/stato/page.tsx`.
- [ ] M2-T05-S03 `ServiceUnavailableCard.tsx`: su errore rete/5xx "Servizio momentaneamente non disponibile, rivolgiti allo sportello" mantenendo l'ultimo stato noto; su 404 card "Targa non trovata" con pulsante "Cerca di nuovo"; su 429 "Troppe richieste, riprova tra poco".
- [ ] M2-T05-S04 Test `tests/components/queue-position-card.test.tsx` per i quattro stati (ok, non trovata, non disponibile, troppe richieste).
- [ ] M2-T05-S04b Accessibilità del portale (unica superficie usata da utenti non addestrati, inclusi clienti anziani): `lang="it"`, etichette ARIA sul form targa, `aria-live="polite"` sul conteggio, target ≥ 48 px, contrasto AAA sul codice in grande, rispetto di `prefers-reduced-motion`; test `tests/e2e/portale-a11y.spec.ts` con axe-core a viewport 375×812: 0 violazioni critiche.
- [ ] M2-T05-S04c Avvolgere le pagine `/cliente` e `/cliente/stato` in `ErrorBoundary` con messaggio "Servizio momentaneamente non disponibile, rivolgiti allo sportello" e pulsante "Riprova"; test che un errore di render della card non spegne il form.
- [ ] M2-T05-S05 Commit `feat(M2-T05): card stato coda con polling, fallback e accessibilità`.

### M2-T06 — QR code stampabili
- [ ] M2-T06-S01 Script `scripts/gen-qr.mts` (libreria `qrcode`, dev dependency) che genera `public/qr/corsia-<n>.svg` e un PDF/HTML stampabile A4 con URL `PUBLIC_BASE_URL/cliente?src=corsia<n>`.
- [ ] M2-T06-S02 Parametro `src` tracciato nel log (nessun dato personale) per capire quale corsia genera più accessi.
- [ ] M2-T06-S03 README: come rigenerare e stampare i QR.
- [ ] M2-T06-S04 Commit `feat(M2-T06): generazione QR code stampabili`.

### M2-T07 — Test e chiusura M2
- [ ] M2-T07-S01 `tests/e2e/portale.spec.ts` (viewport mobile): targa mock → codice e conteggio; operatore prende in carico la pratica precedente → conteggio scende entro 5 s; targa sconosciuta → messaggio.
- [ ] M2-T07-S02 Test di sicurezza: risposta pubblica non contiene `customer`/`vehicle.model`; enumerazione di 50 targhe in un minuto → 429.
- [ ] M2-T07-S03 Aggiornare `README.md`, `ARCHITECTURE.md`, `TASKS.md`; PR → `main`; commit `docs(M2-T07): chiusura milestone M2`.

---

## M3 — P3 · Modulo Comunicazioni (Spoki WhatsApp + fallback SMS Hosting)

- **Priorità**: P3.
- **Obiettivo**: promemoria mattutino post-sync via WhatsApp (SpokiServiceMock) con tracciamento consegna, fallback automatico su SMS (SmsHostingServiceMock), retry con backoff, registro invii in UI e fallback manuale "segna come contattato"; simulazione guasti dimostrabile.
- **Criteri di completamento**: dopo la sync ogni pratica con telefono ha un `NotificationJob`; i numeri che terminano in 9 (ma non in 99) risultano inviati via SMS; quelli in 99 compaiono in "Da contattare a mano" (`MANUAL_REQUIRED`) e si chiudono con "Conferma contatto manuale"; quelli in 8 restano `FAILED` e vengono ritentati con backoff; con `MOCK_SPOKI_MODE=down` tutti passano a SMS senza attese superiori a 5 s; log `[MOCK][Spoki]`/`[MOCK][SmsHosting]` leggibili; test verdi.
- **Dipendenze**: M1 (SyncService, scheduler), `NotificationOrchestrator` dello scaffold.

### M3-T01 — Pianificazione modulo C
- [ ] M3-T01-S01 Annotare qui le decisioni sulla domanda aperta n. 9 (default: invio subito dopo la sync riuscita, template placeholder, mittente SMS "Autoclub"); `YOUR_TURN`/`VEHICLE_READY` restano nel backlog.
- [ ] M3-T01-S02 Branch `feature/M3-comunicazioni`; commit `docs(M3-T01): pianificazione modulo C`.

### M3-T02 — Template messaggi
- [ ] M3-T02-S01 Rivedere `src/application/notifications/templates.ts`: `REMINDER_MORNING` con variabili `{firstName, code, scheduledTime, plate, brandName}`, versione WhatsApp (template key Spoki) e versione SMS entro un singolo segmento GSM-7 (160 caratteri, verificata con `smsSegments` di `sms-hosting.dto.ts`; `renderSms` accorcia il testo senza spezzare il codice).
- [ ] M3-T02-S02 Test snapshot dei testi renderizzati con accenti corretti; test lunghezza SMS.
- [ ] M3-T02-S03 Commit `feat(M3-T02): template promemoria WhatsApp e SMS`.

### M3-T03 — Estensione NotificationOrchestrator
- [ ] M3-T03-S01 `sendMorningReminders(businessDate, correlationId)`: per ogni pratica `WAITING` con telefono crea/riprende il job (`idempotencyKey`), chiamata da `SyncService` su `SyncRun SUCCESS|PARTIAL` (solo prima sync riuscita del giorno; le re-sync creano job solo per pratiche nuove).
- [ ] M3-T03-S02 Politica retry (evoluzione del comportamento dello scaffold descritto in `ARCHITECTURE.md` §3.3): errori `retryable` (TIMEOUT, NETWORK, RATE_LIMIT, UNAVAILABLE) → job `FAILED` con `nextAttemptAt` a backoff esponenziale (30 s, 2 min, 10 min), max 3 tentativi WhatsApp e 2 SMS prima di passare al canale successivo o a `MANUAL_REQUIRED`; errori non retryable → passaggio immediato al canale successivo (come oggi).
- [ ] M3-T03-S03 `refreshDeliveryStatuses(businessDate)`: per job `SENT` interroga `getDeliveryStatus`; `DELIVERED/READ` → `DELIVERED`; `UNDELIVERABLE/FAILED` → fallback SMS.
- [ ] M3-T03-S04 `SUPPRESSED` per pratiche `CANCELLED` prima dell'invio (sottoscrizione a `APPOINTMENT_STATUS_CHANGED`).
- [ ] M3-T03-S05 Su `MANUAL_REQUIRED` scrivere `CrmOutboxEvent { type: 'ANOMALY', anomalyKind: 'NOTIFICATION_FAILED', status: 'PENDING' }`.
- [ ] M3-T03-S06 Test unit: catena completa con numeri 0/7/8/9/99, `whatsappOptIn=false` → SMS diretto, credito SMS a zero → `MANUAL_REQUIRED`, idempotenza fra sync ripetute, backoff con `FixedClock.advance`.
- [ ] M3-T03-S07 Commit `feat(M3-T03): promemoria post-sync, retry con backoff e tracciamento consegna`.

### M3-T04 — Resilienza delle porte esterne
- [ ] M3-T04-S01 `src/services/resilience/with-timeout.ts` (`AbortSignal.timeout` + `CallOptions.signal` combinati, → `ProviderError TIMEOUT`) e `retry.ts` (tentativi con jitter solo su `retryable`).
- [ ] M3-T04-S02 `src/services/resilience/decorators.ts`: wrapper `withResilience(service)` applicato in `services/factory.ts` a tutte le porte (mock e reali) con timeout 5 s di default.
- [ ] M3-T04-S03 Test unit: timeout scatta con `InfinityServiceMock` in modalità `timeout`; retry rispetta il massimo; `signal` esterno interrompe.
- [ ] M3-T04-S04 Commit `feat(M3-T04): decoratori withTimeout e retry sulle porte esterne`.

### M3-T05 — Scheduler: svuotamento dell'outbox notifiche
- [ ] M3-T05-S01a Creare `src/application/scheduler/Scheduler.ts` generico con job registrabili (`register(name, everyMs, run)`, lock per job, `start()`/`stop()`, guard su `globalThis`); test `tests/unit/scheduler.test.ts` con `FixedClock`.
- [ ] M3-T05-S01b Refactor deciso: `SyncScheduler` (M1) diventa il job `syncJob` registrato sullo `Scheduler` generico; il file `SyncScheduler.ts` viene rimosso e i suoi test migrano in `tests/unit/sync-job.test.ts` (nessun comportamento cambia).
- [ ] M3-T05-S01c Job `notificationDrainJob` (ogni 30 s): job `FAILED` con `nextAttemptAt <= now` → `retry`, poi `refreshDeliveryStatuses`.
- [ ] M3-T05-S02 Log strutturato per ciclo (job processati, esiti) e metriche semplici esposte in `/api/v1/health`. Nello stesso task: memoizzare nel container l'esito di `checkExternalHealth()` per ~10 s (`lastHealth`/`lastHealthAt`), così probe Docker e `SystemStatusBanner` condividono una sola tornata di chiamate verso i provider reali, e con `implementation === 'real'` e `NODE_ENV=production` sostituire `detail` con un messaggio generico loggando il dettaglio completo via `ILogger` (l'endpoint è anonimo).
- [ ] M3-T05-S03 Test unit `tests/unit/notification-drain-job.test.ts` con `FixedClock`.
- [ ] M3-T05-S04 Commit `feat(M3-T05): scheduler generico e svuotamento outbox notifiche`.

### M3-T06 — Route Handler notifiche e webhook stub
- [ ] M3-T06-S01 `GET /api/v1/notifications?date=&status=` (job con tentativi), `GET /api/v1/notifications/[id]`.
- [ ] M3-T06-S02 `POST /api/v1/notifications/[id]/manual-confirm` (body `{ note }`, ruolo ADVISOR+) → `confirmManual`; `POST /api/v1/notifications/[id]/retry` → `retry`; `POST /api/v1/notifications/send` per invio singolo `CUSTOM` (SUPERVISOR).
- [ ] M3-T06-S03 `POST /api/v1/webhooks/spoki`: `parseWebhook` del mock, aggiornamento stato job per `providerMessageId`; firma verificata in M7.
- [ ] M3-T06-S04 Test Route Handler (401/403, 404 job, idempotenza manual-confirm).
- [ ] M3-T06-S05 Commit `feat(M3-T06): Route Handler notifiche e webhook Spoki stub`.

### M3-T07 — UI Comunicazioni
- [ ] M3-T07-S01 `src/app/(operator)/comunicazioni/page.tsx` + `modules/notifications/NotificationStatusList.tsx`: tabella job (codice, cliente, canale, stato, tentativi, ultimo errore), filtri "Da contattare a mano", "Falliti", "Consegnati"; polling 5 s.
- [ ] M3-T07-S02 `ManualConfirmDialog.tsx`: nota obbligatoria ("Contattato telefonicamente alle 08:10"), esito `MANUAL_CONFIRMED` con operatore; pulsante "Riprova invio".
- [ ] M3-T07-S03 Badge stato invio nella riga della coda (`QueueRowView.notificationStatus`) con tooltip e link alla pagina Comunicazioni.
- [ ] M3-T07-S03b Avvolgere la pagina `/comunicazioni` in `ErrorBoundary` (messaggio e azione "Ricarica"); test che un errore di render della lista non spegne l'header della shell.
- [ ] M3-T07-S04 Test `tests/components/notification-status-list.test.tsx` (filtri), `tests/components/manual-confirm-dialog.test.tsx` e `tests/e2e/contatto-manuale.spec.ts` ("conferma contatto manuale" per un numero 99).
- [ ] M3-T07-S05 Commit `feat(M3-T07): pagina Comunicazioni con conferma contatto manuale`.

### M3-T08 — Pannello modalità mock a runtime
- [ ] M3-T08-S01 `src/config/runtime-mock-settings.ts` (solo `NODE_ENV !== 'production'`): override in memoria di `mockSpokiMode`, `mockSmsMode`, `mockInfinityMode`, `mockCrmMode`, `mockLatencyMs`; letti dai mock a ogni chiamata.
- [ ] M3-T08-S02 `PATCH /api/v1/system/mock-settings` (ADMIN) e pannello in `/sistema` con interruttori e avviso "Solo ambienti di demo".
- [ ] M3-T08-S03 Test: cambio `mockSpokiMode=down` → invii successivi via SMS.
- [ ] M3-T08-S04 Commit `feat(M3-T08): pannello modalità mock a runtime`.

### M3-T09 — Test di contratto e chiusura M3
- [ ] M3-T09-S01 `tests/contracts/spoki-service.contract.ts` e `sms-hosting-service.contract.ts`: mai throw, idempotenza per `idempotencyKey`, esiti per suffisso, `healthCheck` (rispetta `timeoutMs`/`signal`), `getDeliveryStatus`, credito.
- [ ] M3-T09-S02 README: tabella regole cifre finali e interruttori `MOCK_*`, flusso demo comunicazioni.
- [ ] M3-T09-S03 Aggiornare `ARCHITECTURE.md`, ADR-010 se necessario, `TASKS.md`; PR → `main`; commit `docs(M3-T09): chiusura milestone M3`.

---

## M4 — P4 · Display Campate (4 monitor) — opzionale / Fase 2

- **Priorità**: P4 (opzionale / Fase 2).
- **Obiettivo**: pagina kiosk full-screen per ciascuna delle 4 campate con il codice in servizio e segnalazione grafica di uscita/libero al Completato.
- **Criteri di completamento**: quattro browser in kiosk mode mostrano entro 2 s il codice in servizio sulla propria campata, la segnalazione di libero dopo Completato (RELEASING per `RELEASING_DISPLAY_MS`, poi FREE) e un overlay chiaro se il server non risponde; token campata obbligatorio; test e2e verdi.
- **Dipendenze**: M1 (`QueueService.getBayOccupancy`, occupazione derivata).

### M4-T01 — Pianificazione modulo D
- [ ] M4-T01-S01 Confermare col PO hardware display (domanda n. 13) e durata `RELEASING_DISPLAY_MS`; annotare qui.
- [ ] M4-T01-S02 Branch `feature/M4-display-campate`; commit `docs(M4-T01): pianificazione modulo D`.

### M4-T02 — API display e autenticazione per campata
- [ ] M4-T02-S01 `QueueService.getBayDisplay(bayCode)` → `BayDisplayView` calcolata (unico proprietario della regola, spostato qui da M1-T03-S09; ADR-008): SERVING se pratica `IN_PROGRESS` con quel `bayId` (da `getBayOccupancy`); RELEASING se `completedAt` entro `RELEASING_DISPLAY_MS`; altrimenti FREE, con `lastCompletedCode`; test `tests/unit/bay-display.test.ts` con `FixedClock`.
- [ ] M4-T02-S01b `GET /api/v1/public/bays/[bayCode]` → `BayDisplayView`; `Cache-Control: no-store`.
- [ ] M4-T02-S02 `src/proxy.ts`: `/display/[bayCode]?token=` verifica `Bay.displayToken`, imposta cookie kiosk `HttpOnly` 30 giorni; richieste API display accettate solo con cookie o token valido (403 altrimenti).
- [ ] M4-T02-S03 `GET /api/v1/system/bays` (ADMIN; sotto `system/`, non `public/`, perché `/api/v1/public/**` è anonimo per regola) per lo stato di tutti i display con `lastPollAt` registrato in memoria.
- [ ] M4-T02-S04 Test unit: calcolo stati, token errato → 403, cookie valido → 200.
- [ ] M4-T02-S05 Commit `feat(M4-T02): endpoint display campata con token`.

### M4-T03 — UI kiosk
- [ ] M4-T03-S01 `src/hooks/useBayDisplay.ts`: polling `POLLING_MS.display`, contatore poll falliti consecutivi → stato `OFFLINE` dopo 3, conserva ultimo dato.
- [ ] M4-T03-S02 `src/app/(display)/layout.tsx` (nessuna shell, `cursor: none`, full-screen) e `src/app/(display)/display/[bayCode]/page.tsx`.
- [ ] M4-T03-S03 `modules/bay-displays/BayDisplayBoard.tsx`: codice enorme ad alto contrasto, numero campata, colore brand, orologio; `FreeBayScreen.tsx` con animazione "Campata libera" e ultimo codice servito; transizione RELEASING "Uscita" con animazione.
- [ ] M4-T03-S04 `ConnectionLostOverlay.tsx`: "Connessione assente" sopra l'ultimo stato noto, tentativo automatico; reload completo della pagina ogni `DISPLAY_RELOAD_HOURS` (default 6) per prevenire memory leak; wake lock/`noSleep` dove supportato.
- [ ] M4-T03-S04b Avvolgere la pagina `/display/[bayCode]` in `ErrorBoundary` che mostra l'ultimo stato noto con overlay "Errore di visualizzazione, ricarico…" e ricarica automatica dopo 30 s; test che un errore di render non lascia lo schermo bianco.
- [ ] M4-T03-S05 Test `tests/components/bay-display-board.test.tsx` per i quattro stati; verifica leggibilità a 1920×1080 e 4K (Playwright con `viewport`).
- [ ] M4-T03-S06 Commit `feat(M4-T03): pagina kiosk campata con overlay offline`.

### M4-T04 — Integrazione in Sistema, test e chiusura
- [ ] M4-T04-S01 Sezione "Display" in `/sistema`: 4 card con stato, ultimo poll, link con token (ADMIN), pulsante "Rigenera token".
- [ ] M4-T04-S02 `tests/e2e/display.spec.ts`: prendi in carico → display C1 mostra il codice ≤ 2 s; completato → RELEASING → FREE; token errato → 403.
- [ ] M4-T04-S03 README (setup kiosk Chromium), `ARCHITECTURE.md`, `TASKS.md`; PR → `main`; commit `docs(M4-T04): chiusura milestone M4`.

---

## M5 — P5 · Tablet Ispezione Foto/Video — opzionale / Fase 2

- **Priorità**: P5 (opzionale / Fase 2).
- **Obiettivo**: acquisizione foto e brevi video dal tablet, integrata nel flusso di presa in carico, salvati al fascicolo della pratica dietro `IMediaStorage`.
- **Criteri di completamento**: da tablet, dopo la presa in carico, si scattano foto/video che compaiono nel fascicolo della pratica su qualsiasi postazione; un upload fallito resta in coda e si riprova; i file vivono dietro `IMediaStorage` (`local`); limiti e retention configurabili; test verdi.
- **Dipendenze**: M1 (dettaglio pratica, auth).

### M5-T01 — Pianificazione modulo E
- [ ] M5-T01-S01 Confermare col PO limiti (default 10 MB foto, 30 s/50 MB video), retention (default 90 giorni) e hardware tablet (domande n. 13, 14); annotare qui.
- [ ] M5-T01-S02 Branch `feature/M5-ispezione-media`; commit `docs(M5-T01): pianificazione modulo E`.

### M5-T02 — Storage e MediaService
- [ ] M5-T02-S01 `src/services/real/MediaStorageLocalDisk.ts` (convenzione `<Porta><Implementazione>`, `ARCHITECTURE.md` §7: `.data/media/<yyyy-mm>/<key>`, scrittura atomica, `MEDIA_STORAGE_PROVIDER=local`) selezionato in `services/factory.ts`; `MediaStorageMock` resta per i test; suite `tests/contracts/media-storage.contract.ts` eseguita su entrambe.
- [ ] M5-T02-S02a Decisione presa: le thumbnail sono generate lato client (canvas, max 320 px) e caricate insieme all'originale; nessuna dipendenza nativa (`sharp`) nel server (resta nel backlog). Annotare l'ADR "Storage media e retention" (M5-T04-S02).
- [ ] M5-T02-S02b `src/application/media/MediaService.ts`: `upload({ appointmentId, operatorId, bytes, thumbnailBytes, mimeType, note })` con validazione tipo/dimensione (limiti da M5-T01), salvataggio via `IMediaStorage`, `MediaAsset` in `IMediaRepository`; test `tests/unit/media-service.test.ts` (limiti).
- [ ] M5-T02-S02c `MediaService.list(appointmentId)` e `delete(id, operatorId)` (solo autore o SUPERVISOR, `Result` con `NOT_FOUND`/`VALIDATION`); test permessi.
- [ ] M5-T02-S03 `POST /api/v1/media` (multipart, limite body), `GET /api/v1/media/[id]` (stream con autenticazione), `DELETE /api/v1/media/[id]`.
- [ ] M5-T02-S04 Test unit MediaService (limiti, permessi) e test Route Handler upload/lettura.
- [ ] M5-T02-S05 Commit `feat(M5-T02): storage locale, MediaService e API media`.

### M5-T03 — UI tablet e fascicolo
- [ ] M5-T03-S01 `src/app/(operator)/ispezione/[appointmentId]/page.tsx` con layout tablet (pulsanti grandi, orientamento libero); pulsante "Ispezione" accanto a "Prendi in carico" e nel dettaglio pratica.
- [ ] M5-T03-S02a `modules/inspection-media/MediaCapture.tsx`: `<input capture>` con fallback `getUserMedia`, anteprima, nota per file, generazione thumbnail lato client (M5-T02-S02a); test `tests/components/media-capture.test.tsx`.
- [ ] M5-T03-S02b `modules/inspection-media/UploadQueue.tsx` + `upload-queue.ts`: coda in memoria con riprova automatica a backoff quando `fetch` fallisce e indicatore "N file in attesa di invio"; test `tests/components/upload-queue.test.tsx` (`fetch` fallito → riprova → inviato).
- [ ] M5-T03-S02c Persistenza della coda in IndexedDB (`idb-keyval` o API nativa) per sopravvivere a chiusura del browser e offline prolungato; ripresa all'apertura; test con `fake-indexeddb`.
- [ ] M5-T03-S03 `MediaGallery.tsx` nel dettaglio pratica: griglia thumbnail, lightbox, eliminazione con conferma; test `tests/components/media-gallery.test.tsx`.
- [ ] M5-T03-S03b Avvolgere la pagina `/ispezione/[appointmentId]` in `ErrorBoundary` con messaggio e azione "Torna alla pratica"; test che un errore della galleria non blocca l'acquisizione.
- [ ] M5-T03-S04 Test e2e `tests/e2e/ispezione.spec.ts` con file fixture.
- [ ] M5-T03-S05 Commit `feat(M5-T03): acquisizione media da tablet e galleria fascicolo`.

### M5-T04 — Retention, documentazione e chiusura
- [ ] M5-T04-S01 Job scheduler `mediaRetentionJob` (giornaliero) che elimina asset oltre `MEDIA_RETENTION_DAYS`; log riepilogo.
- [ ] M5-T04-S02 ADR "Storage media e retention"; README (tablet, limiti); `TASKS.md`; PR → `main`; commit `docs(M5-T04): chiusura milestone M5`.

---

## M6 — Modulo F · Integrazione CRM/BDC (no-show e anomalie) + hardening

- **Priorità**: Modulo F (dopo P5, ADR-012).
- **Obiettivo**: consegna asincrona degli eventi outbox verso `ICrmService` con retry, vista supervisor con chiusura manuale, chiusura giornata (no-show automatici), SSE come acceleratore del polling, banner di stato sistema, runbook e Docker.
- **Criteri di completamento**: marcare una pratica No-show produce un evento nell'outbox consegnato a `CrmServiceMock` (log `[MOCK][Crm]` con payload); con `MOCK_CRM_MODE=error` l'evento resta PENDING/FAILED, viene ritentato e può essere chiuso a mano dal supervisor; nessuna azione operatore è mai bloccata dal CRM; SSE attivo con fallback polling; test verdi.
- **Dipendenze**: M1 (outbox NO_SHOW), M3 (NOTIFICATION_FAILED, scheduler).

### M6-T01 — Pianificazione modulo F
- [ ] M6-T01-S01 Confermare col PO le anomalie in scope e il canale CRM (domanda n. 10), orario chiusura giornata e regola no-show automatico (domanda n. 8); annotare qui.
- [ ] M6-T01-S02 Branch `feature/M6-crm-bdc`; commit `docs(M6-T01): pianificazione modulo F`.

### M6-T02 — AnomalyReporter e svuotamento dell'outbox CRM
- [ ] M6-T02-S01a `src/application/crm/AnomalyReporter.ts`: sottoscrizione a `IEventBus`, scheletro con `registerRule`, scrittura `CrmOutboxEvent { type: 'ANOMALY', status: 'PENDING' }` idempotente per `idempotencyKey` (`${appointmentId}:${anomalyKind}:${businessDate}`); test `tests/unit/anomaly-reporter.test.ts` (idempotenza).
- [ ] M6-T02-S01b Regola `EXCESSIVE_SKIPS` su `APPOINTMENT_STATUS_CHANGED` → `SKIPPED` con `skipCount ≥ MAX_SKIPS_BEFORE_ANOMALY`; test dedicato.
- [ ] M6-T02-S01c Regola `MANUAL_APPOINTMENT` su `APPOINTMENT_CREATED` con `source: 'MANUAL'`; test dedicato.
- [ ] M6-T02-S01d Regola `LONG_WAIT` valutata dallo scheduler (pratiche `WAITING|SKIPPED` oltre `LONG_WAIT_MINUTES` dall'orario prenotato, una sola segnalazione per pratica); test con `FixedClock`.
- [ ] M6-T02-S02 `drainDue(now, limit)`: eventi `PENDING|FAILED` con `nextAttemptAt <= now` → `toCrmNoShowPayload`/`toCrmAnomalyPayload` → `crm.notifyNoShow|notifyAnomaly`; successo → `SENT` + `crmAckId`; errore retryable → `FAILED` con backoff (1, 5, 15, 60, 240 min, max 5) ; oltre il massimo o non retryable → `FAILED` definitivo segnalato in UI.
- [ ] M6-T02-S03 `markManual(eventId, operatorId, note)` → `MANUAL` ("Segna inviato al BDC"); `retryNow(eventId)`.
- [ ] M6-T02-S04 Job scheduler `crmDrainJob` ogni 60 s; evento `CRM_EVENT_CHANGED`.
- [ ] M6-T02-S05 Test unit con `CrmServiceMock` in `ok`/`error`/`flaky`: consegna, retry, idempotenza (`received` senza duplicati), markManual.
- [ ] M6-T02-S06 Commit `feat(M6-T02): AnomalyReporter e svuotamento outbox CRM con retry`.

### M6-T03 — Chiusura giornata e no-show automatici
- [ ] M6-T03-S01 `QueueService.closeBusinessDay(businessDate, actor SYSTEM)`: pratiche `WAITING|SKIPPED` residue → `NO_SHOW` con `reason: 'NOT_ARRIVED'` e outbox; eseguito dallo scheduler a `CLOSE_HOUR_LOCAL` (default 19:00) con catch-up, oppure manualmente da `/sistema`.
- [ ] M6-T03-S02 Regola opzionale `NO_SHOW_AFTER_MINUTES` (proposta in UI, mai automatica in orario di apertura senza conferma del PO).
- [ ] M6-T03-S03 Test unit con `FixedClock`; e2e "chiudi giornata" da Sistema.
- [ ] M6-T03-S04 Commit `feat(M6-T03): chiusura giornata con no-show automatici`.

### M6-T04 — API e UI outbox CRM
- [ ] M6-T04-S01 `GET /api/v1/crm/outbox?status=`, `POST /api/v1/crm/outbox/[id]/retry`, `POST /api/v1/crm/outbox/[id]/manual` (SUPERVISOR/ADMIN).
- [ ] M6-T04-S02 `modules/crm/CrmOutboxTable.tsx` e `AnomalyLog.tsx` nella pagina `/sistema` (tab "CRM/BDC"): stato, tentativi, ultimo errore, payload espandibile, pulsanti "Riprova" e "Segna inviato al BDC" con nota.
- [ ] M6-T04-S02b Avvolgere la pagina `/sistema` (e ciascuna scheda: SyncRun, display, CRM/BDC) in `ErrorBoundary` per scheda; test che un errore nella tabella CRM non spegne "Sincronizza ora".
- [ ] M6-T04-S03 Test `tests/components/crm-outbox-table.test.tsx` e Route Handler `tests/unit/http/crm-outbox.test.ts` (403 per ADVISOR).
- [ ] M6-T04-S04 Commit `feat(M6-T04): vista supervisor outbox CRM`.

### M6-T05 — SSE e indicatori di stato sistema
- [ ] M6-T05-S01 `src/lib/realtime/sse-server.ts` + `GET /api/v1/events?since=<seq>`: stream `text/event-stream` dal `IEventBus` con `id: seq`, replay via `listSince`, heartbeat 15 s, chiusura pulita su `signal`.
- [ ] M6-T05-S02 `src/lib/realtime/use-sse.ts` + `src/hooks/useLiveUpdates.ts`: `EventSource` con `Last-Event-ID`, invalidazione delle query per tipo evento; badge "live"/"polling" nell'header; il polling resta attivo come fallback.
- [ ] M6-T05-S03 `SystemStatusBanner` alimentato da `/api/v1/health` ogni 30 s (legge `status` e `providers` dal body: l'endpoint risponde sempre 200 come liveness, il 503 è riservato a `?probe=dependencies`): giallo = degradato con fallback attivo, rosso = dipendenza giù, con azione manuale suggerita per porta; `StaleDataIndicator` unificato. Richiede la memoizzazione dell'health nel container (M3-T05-S02) per non moltiplicare le chiamate ai provider reali.
- [ ] M6-T05-S03b Log strutturato in formato JSON: `src/services/real/JsonConsoleLogger.ts` (una riga JSON per evento con `level`, `time`, `correlationId`, contesto) dietro `ILogger`, selezionato con `LOG_FORMAT=json` (default `pretty` in sviluppo); pino con trasporti file/OTel resta nel backlog. Test `tests/unit/json-console-logger.test.ts`.
- [ ] M6-T05-S04 Test: SSE replay da `since`, riconnessione; componente banner per i tre stati.
- [ ] M6-T05-S05 Commit `feat(M6-T05): SSE con resume, live updates e banner stato sistema`.

### M6-T06 — Runbook, Docker e chiusura M6
- [ ] M6-T06-S01 `docs/RUNBOOK_OPERATIVO.md`: cosa fa l'officina quando Infinity/Spoki/SMS/CRM sono giù, fallback cartaceo, riavvio del servizio, ripristino manuale dello snapshot (`state.json` corrotto → copia di `state.prev.json` o dell'archivio `.data/archive/<businessDate>.json`, verifica del contatore codici prima di riaprire la giornata; M1-T06-S03b), contatti.
- [ ] M6-T06-S02 `Dockerfile` multi-stage (`output: 'standalone'`, utente non root, `TZ=Europe/Rome` per i log di sistema e `APP_TIMEZONE=Europe/Rome` per l'applicazione) e `docker-compose.yml` con volume `.data`, healthcheck sul probe di **liveness** `GET /api/v1/health` (sempre 200 finché il processo risponde: una dipendenza esterna giù non deve far riavviare il container; `?probe=dependencies` resta per il monitoraggio delle dipendenze), `restart: unless-stopped`; guida per servizio Windows alternativo.
- [ ] M6-T06-S03 `tests/contracts/crm-service.contract.ts`; `tests/e2e/no-show.spec.ts` (no-show → outbox → SENT).
- [ ] M6-T06-S04 Aggiornare `README.md`, `ARCHITECTURE.md`, ADR-010/011/012, `TASKS.md`; PR → `main`; commit `docs(M6-T06): chiusura milestone M6`.

---

## M7 — Swap Mock → Real (Infinity, Spoki, SMS Hosting, CRM) con contract test

- **Priorità**: Fase reale.
- **Obiettivo**: introdurre gli adapter reali dietro le stesse interfacce, verificati dalle stesse suite di contratto, senza modificare UI e servizi applicativi; introdurre la persistenza DB (Prisma) e rimuovere il vincolo di istanza singola.
- **Criteri di completamento**: con `<X>_PROVIDER=real` l'applicazione funziona con dati reali senza modifiche in `app/`, `modules/`, `hooks/`, `application/`; ogni adapter reale supera la stessa suite di contratto del mock; i mock restano attivi per sviluppo locale ed e2e; `REPOSITORY_PROVIDER=prisma` supera `appointment-repository.contract`.
- **Dipendenze**: M1..M6; accesso a specifiche/sandbox dei fornitori.

### M7-T01 — Raccolta specifiche reali
- [ ] M7-T01-S01 Infinity: modalità di accesso (API REST, vista DB, export), id stabile, campi telefono/consenso, frequenza aggiornamenti; aggiornare `infinity.dto.ts` + Zod + `infinity.mapper.ts` con fixture reali anonimizzate.
- [ ] M7-T01-S02 Spoki: template approvati Meta, autenticazione, formato webhook e firma; aggiornare `spoki.dto.ts`.
- [ ] M7-T01-S03 SMS Hosting: endpoint, autenticazione, mittente, esiti; aggiornare `sms-hosting.dto.ts`.
- [ ] M7-T01-S04 CRM/BDC: endpoint webhook, autenticazione, schema payload, ack; aggiornare `crm.dto.ts`.
- [ ] M7-T01-S05 ADR "Specifiche reali dei fornitori e impatti sul dominio"; commit `docs(M7-T01): specifiche reali e aggiornamento DTO`.

### M7-T02 — Adapter reali
- [ ] M7-T02-S00 `src/services/real/http-client.ts`: client `fetch` condiviso con `CallOptions` (`signal`, `timeoutMs`), header `x-correlation-id`, mapping degli errori HTTP/rete → `ProviderError` (`AUTH` 401/403, `RATE_LIMIT` 429, `NOT_FOUND` 404, `UNAVAILABLE` 5xx, `TIMEOUT`, `NETWORK`), secrets letti da env; test `tests/unit/http-client.test.ts` con `fetch` finto.
- [ ] M7-T02-S01a `src/services/real/InfinityServiceHttp.ts` — `fetchDailyAgenda` (env `INFINITY_BASE_URL`, `INFINITY_API_KEY`) con validazione Zod della risposta e `withResilience`; test con MSW su fixture reali anonimizzate.
- [ ] M7-T02-S01b `InfinityServiceHttp` — `fetchAppointmentByPlate` e `healthCheck`.
- [ ] M7-T02-S02a `SpokiServiceHttp.ts` — `sendTemplateMessage` e `getDeliveryStatus`; test con MSW.
- [ ] M7-T02-S02b `SpokiServiceHttp` — `parseWebhook` con verifica firma HMAC e `healthCheck`; test di firma valida/invalida/replay.
- [ ] M7-T02-S03a `SmsHostingServiceHttp.ts` — `sendSms` (codifica e segmenti da `smsSegments`) e `getDeliveryStatus`; test con MSW.
- [ ] M7-T02-S03b `SmsHostingServiceHttp` — `getCredits` e `healthCheck`.
- [ ] M7-T02-S04a `CrmServiceHttp.ts` — `notifyNoShow` e `notifyAnomaly` con webhook firmato e gestione ack; test con MSW.
- [ ] M7-T02-S04b `CrmServiceHttp` — `healthCheck` e idempotenza lato client (stessa `idempotencyKey` → stesso ack ricevuto).
- [ ] M7-T02-S05 Sostituire i `throw new NotImplementedError` nei rami `real` di `services/factory.ts`; guard che rifiuta `SERVICES_PROVIDER=real` se `SESSION_SECRET`/credenziali demo sono ancora quelle di default.
- [ ] M7-T02-S06 Commit per adapter: `feat(M7-T02): adapter reale <X>`.

### M7-T03 — Contract test sugli adapter reali
- [ ] M7-T03-S01 Le suite `tests/contracts/*.contract.ts` girano con `CONTRACT_TARGET=real` su sandbox/fixture registrate (MSW o registrazioni HTTP), skippate altrimenti; job CI separato manuale.
- [ ] M7-T03-S02 `POST /api/v1/webhooks/spoki` reale con verifica firma e test di replay.
- [ ] M7-T03-S03 Commit `test(M7-T03): contract suite sugli adapter reali`.

### M7-T04 — Persistenza Prisma
- [ ] M7-T04-S01a `prisma/schema.prisma` (PostgreSQL, fallback SQLite per on-premise) allineato alle entità del dominio (`Appointment` con `customer`/`vehicle` embedded come colonne o JSON, `NotificationJob` + `NotificationAttempt`, `SyncRun`, `CrmOutboxEvent`, `MediaAsset`, dati di riferimento, tabella `sequences`); prima migrazione.
- [ ] M7-T04-S01b `src/repositories/prisma/PrismaAppointmentRepository.ts`: `update` con confronto-e-scambio su `version` (`updateMany where version = expected`), `reserveNextSequence` in transazione, `insert` con vincoli di unicità → `VALIDATION`; verde su `appointment-repository.contract`.
- [ ] M7-T04-S01c `PrismaOperatorRepository`, `PrismaReferenceDataRepository` (seed via migrazione) verdi sulle rispettive suite di contratto.
- [ ] M7-T04-S01d `PrismaNotificationRepository` (`updateJob` con `upsert`), `PrismaSyncRunRepository`, `PrismaCrmOutboxRepository`, `PrismaMediaRepository` verdi sulle rispettive suite di contratto.
- [ ] M7-T04-S02 `repositories/factory.ts`: ramo `prisma`; script `scripts/migrate-snapshot.mts` da `.data/state.json` al DB.
- [ ] M7-T04-S03 Test di concorrenza `tests/unit/prisma-concurrency.test.ts` (due update paralleli → un solo successo, un `VERSION_CONFLICT`).
- [ ] M7-T04-S04 Idempotency cache e rate limit spostati su DB/Redis se multi-istanza; ADR "Rimozione vincolo processo singolo".
- [ ] M7-T04-S05 Commit `feat(M7-T04): repository Prisma e migrazione snapshot`.

### M7-T05 — Attivazione graduale e chiusura
- [ ] M7-T05-S01a `docs/ATTIVAZIONE_GRADUALE.md`: checklist di attivazione per porta (ordine: Infinity, poi Spoki/SMS, poi CRM), criteri di uscita da ogni fase di staging (es. 5 giornate consecutive con sync SUCCESS e health UP, zero `MANUAL_REQUIRED` imputabili all'adapter), procedura di rollback via env (`<X>_PROVIDER=mock`) e responsabili.
- [ ] M7-T05-S01b Configurazione dello staging con `INFINITY_PROVIDER=real` (altri mock), monitoraggio via `SystemStatusBanner`/`/api/v1/health`; l'esercizio settimanale non è un task di sviluppo: si annota qui la data di inizio e l'esito secondo la checklist.
- [ ] M7-T05-S02 Aggiornare `README.md`, `ARCHITECTURE.md`, `RUNBOOK_OPERATIVO.md`, `TASKS.md`; commit `docs(M7-T05): chiusura fase reale`.

---

## Backlog / Idee future

- Autenticazione SSO Microsoft 365 / Entra ID come implementazione di `IAuthService` (Auth.js v5).
- Messaggi aggiuntivi `YOUR_TURN` ("è il tuo turno, campata N") e `VEHICLE_READY` ("vettura pronta") via Spoki/SMS.
- Secondo fattore nel portale cliente (ultime cifre del telefono) e informativa GDPR completa; i18n del portale per clienti stranieri.
- Semantica avanzata di "Salta": spostamento in fondo o dopo N posizioni, proposta automatica di No-show dopo X salti.
- Reportistica: tempi medi di attesa/servizio, no-show per brand, export CSV; retention dello storico.
- Scrittura degli stati verso Infinity (bidirezionale) e re-sync intra-giornata a intervalli.
- Multi-sede: contatori codici, brand e display per sede; `siteId` nel dominio.
- Stampa etichetta/ticket con codice alla presa in carico; notifica desktop all'operatore per nuove pratiche.
- Logger `pino` con trasporto file/OTel (il formato JSON base arriva in M6-T05-S03b), metriche Prometheus su `/api/v1/metrics`, tracing correlationId end-to-end.
- Cronologia persistita per pratica (`appointment.history`) oltre agli eventi in memoria del bus (M1-T15-S01).
- Thumbnail lato server con `sharp` (oggi generate lato client, M5-T02-S02a).
- Firma digitale del cliente sul tablet e invio del fascicolo foto via WhatsApp.
- Chaos panel completo per le demo (latenza per porta, percentuali di errore) oltre al pannello mock di M3-T08.
- Modalità "solo lettura" per tablet supervisore e app PWA installabile per la dashboard.

## Domande aperte

L'elenco unico delle domande per il committente, con i default adottati, è in `ARCHITECTURE.md` §9.2 (una sola copia da mantenere). Le decisioni prese in ogni milestone si annotano nei sotto-task di pianificazione (M1-T01-S01, M2-T01-S01, M3-T01-S01, M4-T01-S01, M5-T01-S01, M6-T01-S01) e, se cambiano l'architettura, in un ADR.
