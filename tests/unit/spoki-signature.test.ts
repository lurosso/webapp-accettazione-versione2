// Firma dei webhook V2 di Spoki: HMAC-SHA256 di "t.corpo", finestra anti-replay, confronto costante.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildSpokiSignatureHeader,
  parseSpokiSignatureHeader,
  signSpokiPayload,
  verifySpokiSignature,
} from '@/lib/http/spoki-signature';

const SEGRETO = 'whsec_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const CORPO = '{"version":2,"event":"message.outbound","data":{"uuid":"m-1","send_status":"Read"}}';
const T = 1_758_550_000; // 2025-09-22 circa, in secondi
const ORA_MS = T * 1000 + 30_000;

describe('Firma dei webhook Spoki (X-Spoki-Signature)', () => {
  it('la firma è HMAC-SHA256 del corpo grezzo preceduto dal timestamp, come nella documentazione di Spoki', () => {
    const attesa = createHmac('sha256', SEGRETO).update(`${T}.${CORPO}`).digest('hex');
    expect(signSpokiPayload(CORPO, SEGRETO, T)).toBe(attesa);
    expect(buildSpokiSignatureHeader(CORPO, SEGRETO, T)).toBe(`t=${T},v2=${attesa}`);
  });

  it('una firma valida entro la finestra passa; fuori finestra è STALE', () => {
    const header = buildSpokiSignatureHeader(CORPO, SEGRETO, T);
    expect(verifySpokiSignature(CORPO, header, SEGRETO, ORA_MS)).toEqual({
      ok: true,
      timestamp: T,
    });
    expect(verifySpokiSignature(CORPO, header, SEGRETO, ORA_MS + 301_000)).toEqual({
      ok: false,
      reason: 'STALE',
    });
    // La finestra vale in entrambe le direzioni (orologi non allineati).
    expect(verifySpokiSignature(CORPO, header, SEGRETO, ORA_MS - 400_000).ok).toBe(false);
  });

  it('corpo modificato, segreto diverso o timestamp cambiato → MISMATCH', () => {
    const header = buildSpokiSignatureHeader(CORPO, SEGRETO, T);
    expect(verifySpokiSignature(CORPO.replace('Read', 'Sent'), header, SEGRETO, ORA_MS)).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
    expect(verifySpokiSignature(CORPO, header, 'whsec_altro-segreto-0123456789', ORA_MS).ok).toBe(
      false,
    );
    const manomesso = header.replace(`t=${T}`, `t=${T + 1}`);
    expect(verifySpokiSignature(CORPO, manomesso, SEGRETO, ORA_MS)).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
  });

  it('intestazione assente o malformata non passa e non lancia', () => {
    expect(verifySpokiSignature(CORPO, null, SEGRETO, ORA_MS)).toEqual({
      ok: false,
      reason: 'MISSING',
    });
    for (const header of [
      '',
      'v2=abc',
      `t=${T}`,
      `t=${T},v2=zz`,
      'x=1,y=2',
      `t=abc,v2=${'a'.repeat(64)}`,
    ]) {
      const r = verifySpokiSignature(CORPO, header, SEGRETO, ORA_MS);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/MISSING|MALFORMED/);
    }
    expect(parseSpokiSignatureHeader(`t=${T},v2=${'A'.repeat(64)}`)).toEqual({
      timestamp: T,
      signature: 'a'.repeat(64),
    });
  });
});
