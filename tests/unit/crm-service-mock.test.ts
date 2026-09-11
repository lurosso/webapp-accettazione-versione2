import { describe, expect, it } from 'vitest';
import type { CrmCheckInPayloadDto, CrmNoShowPayloadDto } from '@/services/dto/crm.dto';
import { CrmServiceMock } from '@/services/mocks/CrmServiceMock';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import type { CrmMockMode } from '@/services/interfaces/mock-config';
import { TestClock } from '../helpers/fixtures';

function buildMock(mode: CrmMockMode = 'ok') {
  const clock = new TestClock();
  return {
    clock,
    crm: new CrmServiceMock({ mode, latencyMs: 0 }, { clock, logger: new NoopLogger() }),
  };
}

const noShow = (key = 'app-1:NO_SHOW:2026-09-10'): CrmNoShowPayloadDto => ({
  schemaVersion: 1,
  idempotencyKey: key,
  appointmentExternalRef: 'INF-1',
  code: 'F001',
  businessDate: '2026-09-10',
  scheduledAt: '2026-09-10T07:00:00.000Z',
  customer: { fullName: 'Mario Rossi', phone: '+393331234560' },
  vehicle: { plate: 'AB123CD', brandCode: 'FIAT', model: '500' },
  detectedAt: '2026-09-10T08:00:00.000Z',
  reason: 'MARKED_BY_OPERATOR',
});

const checkIn = (key = 'app-1:CHECK_IN:2026-09-10'): CrmCheckInPayloadDto => ({
  schemaVersion: 1,
  idempotencyKey: key,
  appointmentExternalRef: 'INF-1',
  code: 'F001',
  businessDate: '2026-09-10',
  customer: { fullName: 'Mario Rossi', phone: '+393331234560' },
  vehicle: { plate: 'AB123CD', brandCode: 'FIAT', model: '500' },
  inspectionNotes: 'Graffio sul paraurti posteriore destro.',
  photos: [
    { url: '/api/v1/media/foto-1.jpg', capturedAt: '2026-09-10T08:05:00.000Z', category: 'FRONT' },
  ],
  completedAt: '2026-09-10T08:10:00.000Z',
  operatorId: 'op-advisor-1',
});

describe('CrmServiceMock', () => {
  it('registra il no-show e restituisce una ricevuta', async () => {
    const { crm } = buildMock();
    const r = await crm.notifyNoShow(noShow());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ackId).toMatch(/^crm-mock-/);
    }
    expect(crm.received).toHaveLength(1);
    expect(crm.received[0]).toMatchObject({ code: 'F001', reason: 'MARKED_BY_OPERATOR' });
  });

  it("registra l'accettazione conclusa con note e foto", async () => {
    const { crm } = buildMock();
    const r = await crm.notifyCheckIn(checkIn());
    expect(r.ok).toBe(true);

    const ricevuto = crm.received[0] as CrmCheckInPayloadDto;
    expect(ricevuto.inspectionNotes).toContain('paraurti');
    expect(ricevuto.photos).toHaveLength(1);
    expect(ricevuto.photos[0]?.url).toBe('/api/v1/media/foto-1.jpg');
    expect(ricevuto.operatorId).toBe('op-advisor-1');
  });

  it('lo stesso evento inviato due volte non viene registrato due volte', async () => {
    const { crm } = buildMock();
    const primo = await crm.notifyCheckIn(checkIn());
    const secondo = await crm.notifyCheckIn(checkIn());
    expect(primo.ok && secondo.ok).toBe(true);
    if (primo.ok && secondo.ok) {
      // Stessa ricevuta: il CRM riconosce la chiave e non duplica.
      expect(secondo.value.ackId).toBe(primo.value.ackId);
    }
    expect(crm.received).toHaveLength(1);
  });

  it('eventi con chiavi diverse vengono registrati entrambi', async () => {
    const { crm } = buildMock();
    await crm.notifyNoShow(noShow('app-1:NO_SHOW:2026-09-10'));
    await crm.notifyNoShow(noShow('app-2:NO_SHOW:2026-09-10'));
    expect(crm.received).toHaveLength(2);
  });

  it('in modalità error restituisce un errore come valore, senza lanciare', async () => {
    const { crm } = buildMock('error');
    const r = await crm.notifyCheckIn(checkIn());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.provider).toBe('CRM');
      expect(r.error.retryable).toBe(false);
    }
    expect(crm.received).toHaveLength(0);
  });

  it('una richiesta già annullata non viene inviata', async () => {
    const { crm } = buildMock();
    const r = await crm.notifyNoShow(noShow(), { signal: AbortSignal.abort() });
    expect(r.ok).toBe(false);
    expect(crm.received).toHaveLength(0);
  });

  it('lo stato di salute riflette la modalità del mock', async () => {
    expect((await buildMock('ok').crm.healthCheck()).status).toBe('UP');
    expect((await buildMock('flaky').crm.healthCheck()).status).toBe('DEGRADED');
    expect((await buildMock('error').crm.healthCheck()).status).toBe('DOWN');
    expect((await buildMock().crm.healthCheck()).implementation).toBe('mock');
  });
});
