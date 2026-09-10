# Struttura di `src/`

Scaffold TypeScript puro del sistema di Gestione Accettazione e Flussi Officina. Nessuna
dipendenza npm: si verifica con `npx -y -p typescript@5 tsc -p tsconfig.json --noEmit`.
Il bootstrap Next.js (package.json, App Router, Tailwind, test) è il prossimo task di M0
(M0-T06 e seguenti) in `TASKS.md`; le sottocartelle di `app/` nascono con M0-T11.

## Strati (dal più interno al più esterno)

| Cartella | Ruolo | Può importare |
| --- | --- | --- |
| `domain/` | Entità, value object, state machine, eventi, errori, read model. PURO. | nulla |
| `application/` | Casi d'uso (es. `NotificationOrchestrator`): logica reale, mai mockata. | `domain`, `services/interfaces`, `repositories/interfaces`, `config/constants` |
| `services/` | Porte verso l'esterno (`interfaces/`, inclusi i tipi neutri `provider-kinds.ts` e `mock-config.ts`), DTO di trasporto, mapper puri, `mocks/`, `real/` | `domain`, `lib` |
| `repositories/` | Persistenza interna: `interfaces/` + `in-memory/` (Prisma in futuro) | `domain`, `services/interfaces` |
| `config/` | Composition root: `env.ts`, `seed.ts`, `container.ts` | tutto (è l'unico che cabla le classi concrete; `env.ts` importa solo tipi neutri, mai classi mock) |
| `lib/` | Utilità senza dipendenze di dominio (`dates.ts`, `hash.ts`) | `domain` (solo tipi) |
| `app/`, `modules/`, `components/`, `hooks/`, `store/` | UI Next.js/React (M0+) | `application`, `domain`, `lib`, `config/container` |

## Regola d'Oro e import vietati

Tutti i sistemi esterni (Infinity, Spoki, SMS Hosting, CRM) e la persistenza stanno dietro
interfacce (`IInfinityService`, `ISpokiService`, `ISmsHostingService`, `ICrmService`,
`I*Repository`). Solo tre file conoscono le classi concrete: `services/factory.ts`,
`repositories/factory.ts` e `config/container.ts`. È **vietato** importare
`services/mocks`, `services/real`, `repositories/in-memory`, `repositories/prisma` da
`app/`, `modules/`, `components/`, `hooks/`, `application/` (regola ESLint da M0).
Gli errori attesi sono valori `Result<T, E>`, mai eccezioni: l'officina non deve mai bloccarsi.

Convenzione dei nomi delle implementazioni: `<Porta senza I><Implementazione>`, con `Mock`
(`services/mocks`), `Http` o `LocalDisk`/`Blob` (`services/real`): `InfinityServiceMock`,
`InfinityServiceHttp`, `MediaStorageMock`, `MediaStorageLocalDisk`. `InMemory`/`Prisma` sono
riservati ai repository.

## Variabili env dei provider

`SERVICES_PROVIDER=mock|real` (default globale), sovrascrivibile per porta con
`INFINITY_PROVIDER`, `SPOKI_PROVIDER`, `SMS_PROVIDER`, `CRM_PROVIDER`;
`REPOSITORY_PROVIDER=memory|prisma`; `MEDIA_STORAGE_PROVIDER=memory|local|blob`.
Fuso dell'officina: `APP_TIMEZONE` (default `Europe/Rome`, validato come zona IANA; la
variabile di sistema `TZ` è ignorata di proposito perché nei container è spesso UTC).
Interruttori dei mock: `MOCK_SEED`, `MOCK_LATENCY_MS`, `MOCK_INFINITY_MODE`,
`MOCK_INFINITY_FLAKY_FAILURES`, `MOCK_INFINITY_CANCEL_ON_SECOND_CALL`, `MOCK_SPOKI_FAIL_SUFFIX`,
`MOCK_SPOKI_FAILURE_RATE`, `MOCK_SPOKI_MODE`, `MOCK_SMS_FAIL_SUFFIX`, `MOCK_SMS_FAILURE_RATE`,
`MOCK_SMS_MODE`, `MOCK_SMS_CREDITS`, `MOCK_CRM_MODE`, `MOCK_DELIVERY_DELAY_MS` (vedi `config/env.ts`).
Il container rifiuta all'avvio (`ConfigurationError`) le credenziali demo del seed con
`NODE_ENV=production` o con un provider `real`/`prisma`.

Regola "ultima cifra del telefono" (`services/interfaces/mock-config.ts`):
0-6 WhatsApp consegnato; 7 WhatsApp non consegnabile (subito) → SMS; 8 timeout retryable su
entrambi i canali → job `FAILED` (retry automatico da M3, intanto confermabile a mano);
9 WhatsApp rifiutato → SMS; 99 falliscono entrambi in modo non retryable → `MANUAL_REQUIRED`
(contatto manuale). Quindi 8 e 99 compaiono entrambi in "Da contattare a mano", ma solo 8
viene ritentato in automatico.

## Come sostituire un mock (M7)

1. Creare `services/real/<Porta>Http.ts` che implementa la stessa interfaccia.
2. Farle superare la suite di contratto `tests/contracts/<porta>.contract.ts`.
3. Sostituire il `throw NotImplementedError` nel ramo `real` di `services/factory.ts`.
4. Impostare `<PORTA>_PROVIDER=real`. Nessun file di UI o `application/` cambia.

## Verifica

```bash
npx -y -p typescript@5 tsc -p tsconfig.json --noEmit
```
