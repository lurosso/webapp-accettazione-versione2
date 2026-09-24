// Accesso da un indirizzo diverso da localhost (l'iPad in Wi-Fi che apre http://<ip-del-pc>:3000).
//
// Due cose devono valere qualunque sia l'host della richiesta: il cookie di sessione non deve
// portare un `domain` (altrimenti vale da un indirizzo e sparisce da un altro) e non deve essere
// `Secure` fuori dalla produzione (in HTTP semplice verrebbe scartato in silenzio); e il dev server
// deve accettare le proprie risorse dagli indirizzi della macchina, quali che siano oggi.
import { describe, expect, it } from 'vitest';
import { isCsrfOriginAllowed } from 'next/dist/server/app-render/csrf-protection';
import {
  devOrigins,
  devOriginsFrom,
  LAN_DEV_ORIGIN_PATTERNS,
  lanDevOriginsEnabled,
} from '@/config/dev-origins';
import { clearedSessionCookieOptions, sessionCookieOptions } from '@/lib/http/session-cookie';

describe('cookie di sessione: uguale da localhost e da un IP di rete', () => {
  it('non ha mai un dominio: il browser lo lega all’host da cui è arrivato', () => {
    const opts = sessionCookieOptions(
      'accettazione_session',
      'tok',
      '2026-09-21T17:00:00.000Z',
      'development',
    );
    expect('domain' in opts).toBe(false);
    expect(opts.path).toBe('/');
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.expires).toEqual(new Date('2026-09-21T17:00:00.000Z'));
  });

  it('è Secure solo in produzione: in HTTP semplice un cookie Secure viene scartato', () => {
    expect(sessionCookieOptions('c', 't', '2026-09-21T17:00:00.000Z', 'development').secure).toBe(
      false,
    );
    expect(sessionCookieOptions('c', 't', '2026-09-21T17:00:00.000Z', 'test').secure).toBe(false);
    expect(sessionCookieOptions('c', 't', '2026-09-21T17:00:00.000Z', 'production').secure).toBe(
      true,
    );
  });

  it('la cancellazione usa lo stesso nome e percorso, scaduto subito e senza dominio', () => {
    const opts = clearedSessionCookieOptions('accettazione_session');
    expect(opts).toMatchObject({ name: 'accettazione_session', value: '', path: '/', maxAge: 0 });
    expect('domain' in opts).toBe(false);
    expect(opts.expires).toBeUndefined();
  });
});

describe('origini di sviluppo: gli indirizzi della macchina, quali che siano', () => {
  const interfacce = {
    'Loopback Pseudo-Interface 1': [
      { family: 'IPv4', internal: true, address: '127.0.0.1' },
      { family: 'IPv6', internal: true, address: '::1' },
    ],
    'Wi-Fi': [
      { family: 'IPv4', internal: false, address: '10.50.193.83' },
      { family: 'IPv6', internal: false, address: 'fe80::1%12' },
    ],
    'Ethernet 2': [{ family: 'IPv4', internal: false, address: '10.40.193.124' }],
    Bluetooth: undefined,
  };

  it('prende solo gli IPv4 non di loopback, uno per scheda', () => {
    expect(devOriginsFrom(interfacce, undefined)).toEqual(['10.50.193.83', '10.40.193.124']);
  });

  it('accetta la forma numerica della famiglia, come nelle versioni vecchie di Node', () => {
    expect(
      devOriginsFrom({ eth: [{ family: 4, internal: false, address: '192.168.1.20' }] }, ''),
    ).toEqual(['192.168.1.20']);
  });

  it('aggiunge gli indirizzi scritti a mano, ripuliti e senza duplicati', () => {
    expect(devOriginsFrom(interfacce, ' lrossinb.local, 10.50.193.83 ,, officina.lan ')).toEqual([
      '10.50.193.83',
      '10.40.193.124',
      'lrossinb.local',
      'officina.lan',
    ]);
  });

  it('senza schede di rete e senza extra la lista è vuota, non un errore', () => {
    expect(devOriginsFrom({}, undefined)).toEqual([]);
  });
});

describe('origini di sviluppo: la rete locale, anche se l’IP cambia a server avviato', () => {
  // Il confronto è quello di Next (lo stesso che usa il blocco delle risorse di sviluppo): se Next
  // cambiasse la sintassi dei jolly, questo test lo direbbe prima dell'iPad.
  const ammessa = (host: string): boolean =>
    isCsrfOriginAllowed(host, ['**.localhost', 'localhost', ...LAN_DEV_ORIGIN_PATTERNS]);

  it('qualunque indirizzo delle reti private passa, compreso quello preso dopo l’avvio', () => {
    for (const ip of [
      '10.50.193.91',
      '10.40.193.124',
      '10.0.0.1',
      '192.168.178.45',
      '192.168.1.20',
      '172.16.0.5',
      '172.31.255.254',
      'lrossinb.local',
    ]) {
      expect(ammessa(ip), ip).toBe(true);
    }
  });

  it('un indirizzo pubblico, un sito esterno o un finto sottodominio restano fuori', () => {
    for (const host of [
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '11.50.193.91',
      '192.169.1.1',
      'evil.example',
      '10.50.193.91.evil.example',
      'local',
    ]) {
      expect(ammessa(host), host).toBe(false);
    }
  });

  it('si spegne solo con un valore esplicito di ALLOWED_DEV_ORIGINS_LAN', () => {
    expect(lanDevOriginsEnabled(undefined)).toBe(true);
    expect(lanDevOriginsEnabled('')).toBe(true);
    expect(lanDevOriginsEnabled('true')).toBe(true);
    for (const v of ['false', 'FALSE', ' 0 ', 'no', 'off']) {
      expect(lanDevOriginsEnabled(v), v).toBe(false);
    }
  });

  it('devOrigins mette insieme indirizzi rilevati e jolly, e senza jolly restano i soli rilevati', () => {
    const prima = process.env['ALLOWED_DEV_ORIGINS_LAN'];
    try {
      delete process.env['ALLOWED_DEV_ORIGINS_LAN'];
      const conRete = devOrigins();
      expect(conRete).toEqual(expect.arrayContaining([...LAN_DEV_ORIGIN_PATTERNS]));
      process.env['ALLOWED_DEV_ORIGINS_LAN'] = 'false';
      const senza = devOrigins();
      for (const p of LAN_DEV_ORIGIN_PATTERNS) {
        expect(senza).not.toContain(p);
      }
    } finally {
      if (prima === undefined) {
        delete process.env['ALLOWED_DEV_ORIGINS_LAN'];
      } else {
        process.env['ALLOWED_DEV_ORIGINS_LAN'] = prima;
      }
    }
  });
});
