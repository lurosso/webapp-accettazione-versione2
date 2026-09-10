// Richiesta di invio verso SMS Hosting (canale di fallback) e regole di segmentazione.

import type { PhoneE164 } from '@/domain/value-objects/phone';

/** Lunghezza massima di un SMS singolo in codifica GSM-7. */
export const SMS_MAX_LENGTH = 160;

/** Lunghezza massima di un SMS singolo in codifica UCS-2 (testo con caratteri fuori GSM-7). */
export const SMS_MAX_LENGTH_UCS2 = 70;

/** Caratteri per segmento in un SMS concatenato (GSM-7 / UCS-2). */
const SMS_MULTIPART_GSM7 = 153;
const SMS_MULTIPART_UCS2 = 67;

/** Codifica con cui il gateway invierà il testo. */
export type SmsEncoding = 'GSM-7' | 'UCS-2';

/**
 * Alfabeto base GSM 03.38 (include le accentate italiane à è é ì ò ù) più i caratteri
 * dell'estensione che costano due settetti. L'apostrofo tipografico (’) NON è incluso:
 * nei testi italiani usare l'apostrofo ASCII (').
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '\f^{}\\[~]|€';

/** Indica se il testo è rappresentabile interamente in GSM-7. */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch)) {
      return false;
    }
  }
  return true;
}

/** Lunghezza in settetti GSM-7 (i caratteri estesi contano doppio). */
function gsm7Length(text: string): number {
  let length = 0;
  for (const ch of text) {
    length += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  }
  return length;
}

/** Codifica e numero di segmenti che il gateway userà per il testo (costo reale dell'SMS). */
export function smsSegments(text: string): { readonly encoding: SmsEncoding; readonly segments: number; readonly length: number } {
  if (isGsm7(text)) {
    const length = gsm7Length(text);
    const segments = length <= SMS_MAX_LENGTH ? 1 : Math.ceil(length / SMS_MULTIPART_GSM7);
    return { encoding: 'GSM-7', segments: Math.max(1, segments), length };
  }
  const length = [...text].length;
  const segments = length <= SMS_MAX_LENGTH_UCS2 ? 1 : Math.ceil(length / SMS_MULTIPART_UCS2);
  return { encoding: 'UCS-2', segments: Math.max(1, segments), length };
}

/** Invio di un SMS. */
export interface SmsSendRequestDto {
  /** Chiave di idempotenza: stesso valore → stessa ricevuta. */
  readonly idempotencyKey: string;
  readonly to: PhoneE164;
  /** Testo in chiaro; oltre un segmento il gateway concatena (costo multiplo), il mock avvisa nel log. */
  readonly text: string;
  /** Mittente alfanumerico registrato, null = predefinito dell'account. */
  readonly senderId: string | null;
  readonly correlationId: string;
}
