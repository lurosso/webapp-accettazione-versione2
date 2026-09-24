// GET /api/v1/notifications e POST /api/v1/notifications/[id]/actions dal punto di vista di chi
// lavora la schermata Comunicazioni: sessione obbligatoria, banco e amministratore ammessi, comandi validati,
// «Prendo io» esclusivo e chiusura con l'esito. Container isolato al posto di quello globale.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/notifications/route';
import { POST } from '@/app/api/v1/notifications/[id]/actions/route';
import {
  createContainer,
  resetContainerForTests,
  setContainerForTests,
  type Container,
} from '@/config/container';
import { SESSION_COOKIE_NAME } from '@/config/auth';
import type { NotificationJob } from '@/domain/entities/notification';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { makeAppointment, TestClock } from '../helpers/fixtures';

const ORIGINE = 'http://officina.local';
let container: Container;
let clock: TestClock;
const cookie: Record<string, string> = {};

async function accedi(username: string, workstationId: string): Promise<string> {
  const r = await container.authService.login({ username, password: 'demo', workstationId });
  if (!r.ok) {
    throw new Error(`login ${username}: ${r.error.message}`);
  }
  return `${SESSION_COOKIE_NAME}=${r.value.token}`;
}

function lettura(chi: string | null, query = ''): NextRequest {
  return new NextRequest(`${ORIGINE}/api/v1/notifications${query}`, {
    headers: chi === null ? {} : { cookie: cookie[chi] ?? '' },
  });
}

function comando(
  chi: string | null,
  jobId: string,
  body: unknown,
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`${ORIGINE}/api/v1/notifications/${jobId}/actions`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(chi === null ? {} : { cookie: cookie[chi] ?? '' }),
      },
    }),
    { params: Promise.resolve({ id: jobId }) },
  ];
}

/** Pratica di oggi con un numero che va in timeout su entrambi i canali (ultima cifra 8). */
async function messaggioFallito(): Promise<NotificationJob> {
  const base = makeAppointment({ businessDate: clock.today() });
  const appointment = {
    ...base,
    customer: { ...base.customer, phone: '+393331234568' as PhoneE164 },
  };
  const r = await container.repos.appointments.insert(appointment);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  const brand = (await container.repos.referenceData.listBrands()).find(
    (b) => b.id === appointment.brandId,
  );
  if (brand === undefined) {
    throw new Error('marchio non trovato');
  }
  const run = await container.notificationOrchestrator.sendReminder({
    appointment,
    brand,
    kind: 'REMINDER_SAME_DAY',
    correlationId: 'c-route',
  });
  return run.job;
}

beforeAll(async () => {
  clock = new TestClock('2026-09-10T08:00:00.000Z');
  container = createContainer({
    env: {
      messagingStandby: false,
      messagingTriggersEnabled: false,
      remindersEnabled: false,
      spokiProvider: 'mock',
      smsProvider: 'mock',
      crmProvider: 'mock',
      infinityProvider: 'mock',
      repositoryProvider: 'memory',
      mediaStorageProvider: 'memory',
      mockLatencyMs: 0,
      mockDeliveryDelayMs: 0,
    },
    clock,
    logger: new NoopLogger(),
    store: InMemoryStore.createIsolated(),
    sessionSecret: 's'.repeat(40),
  });
  setContainerForTests(container);
  cookie['banco'] = await accedi('mario.rossi', 'ws-p1');
  cookie['collega'] = await accedi('laura.bianchi', 'ws-p2');
  cookie['admin'] = await accedi('admin', 'ws-p4');
});

afterAll(() => {
  resetContainerForTests();
});

describe('Rotte della schermata Comunicazioni', () => {
  it('senza sessione 401, sia in lettura sia sui comandi', async () => {
    expect((await GET(lettura(null))).status).toBe(401);
    expect((await POST(...comando(null, 'qualunque', { action: 'claim' }))).status).toBe(401);
  });

  it('il banco e l’amministratore vedono il messaggio in riprova con i conteggi', async () => {
    const job = await messaggioFallito();
    for (const chi of ['banco', 'admin']) {
      const r = await GET(lettura(chi));
      expect(r.status).toBe(200);
      const vista = (await r.json()) as {
        rows: { jobId: string; nextAttemptAt: string | null }[];
        retryingCount: number;
      };
      expect(vista.rows.some((row) => row.jobId === job.id && row.nextAttemptAt !== null)).toBe(
        true,
      );
      expect(vista.retryingCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('comando sconosciuto o esito non previsto: 400; notifica inesistente: 404', async () => {
    const job = await messaggioFallito();
    expect((await POST(...comando('banco', job.id, { action: 'boh' }))).status).toBe(400);
    expect(
      (await POST(...comando('banco', job.id, { action: 'confirm', outcome: 'INVENTATO' }))).status,
    ).toBe(400);
    expect((await POST(...comando('banco', 'non-esiste', { action: 'claim' }))).status).toBe(404);
  });

  it('«Prendo io» è esclusivo (409 al collega), poi l’esito chiude e la riga passa fra le gestite', async () => {
    const job = await messaggioFallito();
    const presa = await POST(...comando('banco', job.id, { action: 'claim' }));
    expect(presa.status).toBe(200);
    expect(((await presa.json()) as { row: { claimedByMe: boolean } }).row.claimedByMe).toBe(true);

    const collega = await POST(...comando('collega', job.id, { action: 'claim' }));
    expect(collega.status).toBe(409);

    const chiusa = await POST(
      ...comando('banco', job.id, {
        action: 'confirm',
        outcome: 'PHONE_CALLED',
        note: 'Arriva alle 11',
      }),
    );
    expect(chiusa.status).toBe(200);
    const riga = ((await chiusa.json()) as { row: { status: string; manualOutcomeLabel: string } })
      .row;
    expect(riga.status).toBe('MANUAL_CONFIRMED');
    expect(riga.manualOutcomeLabel).toBe('Cliente chiamato al telefono');

    const gestite = (await (await GET(lettura('admin', '?vista=gestite'))).json()) as {
      rows: { jobId: string }[];
    };
    expect(gestite.rows.map((r) => r.jobId)).toContain(job.id);
    const aperte = (await (await GET(lettura('admin'))).json()) as { rows: { jobId: string }[] };
    expect(aperte.rows.map((r) => r.jobId)).not.toContain(job.id);
  });
});
