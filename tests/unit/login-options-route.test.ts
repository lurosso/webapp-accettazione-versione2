// GET /api/v1/auth/login-options: lo stato delle postazioni che il form di login richiede ogni pochi
// secondi. Stessi dati della pagina, senza cache; un collega che si siede o si alza si vede al giro
// dopo, e l'amministratore collegato non occupa niente.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/auth/login-options/route';
import {
  createContainer,
  resetContainerForTests,
  setContainerForTests,
  type Container,
} from '@/config/container';
import { setTrustProxyHeadersForTests } from '@/lib/http/rate-limit';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { TestClock } from '../helpers/fixtures';

let container: Container;

beforeAll(() => {
  container = createContainer({
    env: {
      messagingStandby: true,
      remindersEnabled: false,
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
    sessionSecret: 'q'.repeat(40),
  });
  setContainerForTests(container);
});

afterAll(() => {
  resetContainerForTests();
});

interface Opzione {
  readonly id: string;
  readonly disabled: boolean;
  readonly reason: string | null;
}

async function stato(
  ip = '10.50.1.20',
): Promise<{ status: number; options: Opzione[]; cache: string | null }> {
  const r = await GET(
    new NextRequest('http://10.50.193.91:3000/api/v1/auth/login-options', {
      headers: { 'x-forwarded-for': ip },
    }),
  );
  const corpo = (await r.json()) as { options?: Opzione[] };
  return { status: r.status, options: corpo.options ?? [], cache: r.headers.get('cache-control') };
}

describe('GET /api/v1/auth/login-options', () => {
  it('tutte libere all’inizio, senza cache', async () => {
    const r = await stato();
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options.every((o) => !o.disabled)).toBe(true);
  });

  it('un accettatore che si siede compare al giro dopo; l’amministratore no', async () => {
    const mario = await container.authService.login({
      username: 'mario.rossi',
      password: 'demo',
      workstationId: 'ws-p1',
    });
    const admin = await container.authService.login({
      username: 'admin',
      password: 'demo',
      workstationId: 'ws-p2',
    });
    expect(mario.ok && admin.ok).toBe(true);
    const r = await stato();
    const occupate = r.options.filter((o) => o.disabled);
    expect(occupate.map((o) => o.id)).toEqual(['ws-p1']);
    expect(occupate[0]?.reason).toContain('Mario Rossi');

    if (mario.ok) {
      await container.authService.logout(mario.value.session);
    }
    expect((await stato()).options.every((o) => !o.disabled)).toBe(true);
  });

  it('dietro un proxy fidato, un client che la martella viene fermato con 429', async () => {
    // Senza proxy fidato l'indirizzo non si conosce e il tetto non si applica (come per il login).
    setTrustProxyHeadersForTests(true);
    let ultimo = 200;
    for (let i = 0; i < 130; i += 1) {
      ultimo = (await stato('10.50.1.99')).status;
    }
    expect(ultimo).toBe(429);
    // Gli altri indirizzi non ne risentono.
    expect((await stato('10.50.1.21')).status).toBe(200);
    setTrustProxyHeadersForTests(null);
  });
});
