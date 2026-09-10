// Modalità e regole condivise fra la configurazione (`config/env.ts`) e i mock.
// Unica fonte di verità per i valori che altrimenti verrebbero ricopiati a mano
// (es. i suffissi telefonici '9' e '99'). Nessuna classe mock è importata da qui.

/** Modalità del mock Infinity (env `MOCK_INFINITY_MODE`). */
export type InfinityMockMode = 'ok' | 'error' | 'timeout' | 'flaky' | 'partial' | 'empty';

/** Modalità del mock CRM (env `MOCK_CRM_MODE`). */
export type CrmMockMode = 'ok' | 'error' | 'timeout' | 'flaky';

/** Modalità dei mock Spoki e SMS Hosting (env `MOCK_SPOKI_MODE`, `MOCK_SMS_MODE`). */
export type ProviderMockMode = 'ok' | 'down';

/**
 * Regola "ultima cifra del telefono" applicata dai mock di Spoki e SMS Hosting
 * (documentata nel README e in ARCHITECTURE.md §3.3):
 * - 0-6 → WhatsApp SENT, poi DELIVERED dopo `MOCK_DELIVERY_DELAY_MS`;
 * - 7   → WhatsApp SENT ma subito UNDELIVERABLE → fallback SMS;
 * - 8   → TIMEOUT retryable su entrambi i canali → job FAILED (retry automatico da M3,
 *         intanto confermabile a mano);
 * - 9   → WhatsApp INVALID_REQUEST non retryable → SMS immediato;
 * - 99  → falliscono entrambi i canali in modo non retryable → MANUAL_REQUIRED.
 * I suffissi 9 e 99 sono i default di `MOCK_SPOKI_FAIL_SUFFIX` e `MOCK_SMS_FAIL_SUFFIX`.
 */
export const MOCK_PHONE_RULES = {
  delivered: ['0', '1', '2', '3', '4', '5', '6'],
  whatsappUndeliverable: '7',
  timeout: '8',
  whatsappInvalid: '9',
  bothChannelsFail: '99',
} as const;
