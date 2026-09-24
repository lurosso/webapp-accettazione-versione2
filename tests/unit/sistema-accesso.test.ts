// Sistema dopo il 2026-09-24: l'accettatore manda solo la segnalazione (ticket), la diagnostica è
// dell'amministratore. Le due cose si provano sulle rotte, con sessioni vere su un container isolato.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as segnala } from '@/app/api/v1/system/alerts/route';
import { GET as diagnostica } from '@/app/api/v1/system/diagnostics/route';
import { SESSION_COOKIE_NAME } from '@/config/auth';
import {
  createContainer,
  resetContainerForTests,
  setContainerForTests,
  type Container,
} from '@/config/container';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { TestClock } from '../helpers/fixtures';

const ORIGINE = 'http://officina.local';
let container: Container;
const cookie: Record<string, string> = {};

async function accedi(username: string, workstationId: string): Promise<string> {
  const r = await container.authService.login({ username, password: 'demo', workstationId });
  if (!r.ok) {
    throw new Error(`login ${username}: ${r.error.message}`);
  }
  return `${SESSION_COOKIE_NAME}=${r.value.token}`;
}

beforeAll(async () => {
  container = createContainer({
    env: {
      messagingStandby: true,
      spokiProvider: 'mock',
      smsProvider: 'mock',
      crmProvider: 'mock',
      infinityProvider: 'mock',
      repositoryProvider: 'memory',
      mediaStorageProvider: 'memory',
      mockLatencyMs: 0,
    },
    clock: new TestClock('2026-09-10T08:00:00.000Z'),
    logger: new NoopLogger(),
    store: InMemoryStore.createIsolated(),
    sessionSecret: 's'.repeat(40),
  });
  setContainerForTests(container);
  cookie['banco'] = await accedi('mario.rossi', 'ws-p1');
  cookie['admin'] = await accedi('admin', 'ws-p4');
});

afterAll(() => {
  resetContainerForTests();
});

describe('Sistema: ticket per il banco, diagnostica per l’amministratore', () => {
  it('la diagnostica risponde 403 all’accettatore e 200 all’amministratore', async () => {
    const banco = await diagnostica(
      new NextRequest(`${ORIGINE}/api/v1/system/diagnostics`, {
        headers: { cookie: cookie['banco'] ?? '' },
      }),
    );
    expect(banco.status).toBe(403);
    const admin = await diagnostica(
      new NextRequest(`${ORIGINE}/api/v1/system/diagnostics`, {
        headers: { cookie: cookie['admin'] ?? '' },
      }),
    );
    expect(admin.status).toBe(200);
  });

  it('l’accettatore può sempre mandare una segnalazione all’amministratore', async () => {
    const r = await segnala(
      new NextRequest(`${ORIGINE}/api/v1/system/alerts`, {
        method: 'POST',
        body: JSON.stringify({
          code: 'HARDWARE-MANUALE',
          component: 'HARDWARE',
          message: 'La stampante dello sportello B non stampa',
        }),
        headers: { 'content-type': 'application/json', cookie: cookie['banco'] ?? '' },
      }),
    );
    expect(r.status).toBe(201);
  });
});
