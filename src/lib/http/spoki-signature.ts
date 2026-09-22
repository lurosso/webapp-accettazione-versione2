// Firma dei webhook V2 di Spoki: `X-Spoki-Signature: t=<unix>,v2=<hex>` dove `v2` è
// HMAC-SHA256(secret, `${t}.${corpo grezzo}`). Si verifica sul corpo così com'è arrivato (non su
// un JSON riserializzato) e si rifiuta un timestamp troppo lontano, così un webhook intercettato
// non si può rigiocare all'infinito. Confronto a tempo costante, come per ogni segreto.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Finestra di validità del timestamp: cinque minuti, come suggerisce Spoki. */
export const SPOKI_SIGNATURE_TOLERANCE_SECONDS = 300;

export type SpokiSignatureVerdict =
  | { readonly ok: true; readonly timestamp: number }
  | { readonly ok: false; readonly reason: 'MISSING' | 'MALFORMED' | 'MISMATCH' | 'STALE' };

/** Le due parti dell'intestazione, o null se non ha la forma attesa. */
export function parseSpokiSignatureHeader(
  header: string,
): { readonly timestamp: number; readonly signature: string } | null {
  const parti = new Map<string, string>();
  for (const pezzo of header.split(',')) {
    const i = pezzo.indexOf('=');
    if (i <= 0) {
      continue;
    }
    parti.set(pezzo.slice(0, i).trim(), pezzo.slice(i + 1).trim());
  }
  const t = parti.get('t');
  const v2 = parti.get('v2');
  if (t === undefined || v2 === undefined || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(v2)) {
    return null;
  }
  return { timestamp: Number(t), signature: v2.toLowerCase() };
}

/** Firma attesa per un corpo e un timestamp: serve ai test e agli invii di prova. */
export function signSpokiPayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number,
): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
}

/** Intestazione completa `t=…,v2=…` per un corpo (test e simulazioni). */
export function buildSpokiSignatureHeader(
  rawBody: string,
  secret: string,
  timestampSeconds: number,
): string {
  return `t=${timestampSeconds},v2=${signSpokiPayload(rawBody, secret, timestampSeconds)}`;
}

/**
 * Verifica la firma di un webhook. `nowMs` è l'istante corrente (iniettato: niente `Date.now()`
 * nascosto), `toleranceSeconds` la finestra ammessa avanti e indietro.
 */
export function verifySpokiSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number,
  toleranceSeconds = SPOKI_SIGNATURE_TOLERANCE_SECONDS,
): SpokiSignatureVerdict {
  if (header === null || header.trim() === '') {
    return { ok: false, reason: 'MISSING' };
  }
  const parsed = parseSpokiSignatureHeader(header);
  if (parsed === null) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const attesa = Buffer.from(signSpokiPayload(rawBody, secret, parsed.timestamp), 'hex');
  const fornita = Buffer.from(parsed.signature, 'hex');
  if (attesa.length !== fornita.length || !timingSafeEqual(attesa, fornita)) {
    return { ok: false, reason: 'MISMATCH' };
  }
  if (Math.abs(nowMs / 1000 - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'STALE' };
  }
  return { ok: true, timestamp: parsed.timestamp };
}
