// Gli attributi del cookie di sessione, in un posto solo e senza dipendenze, così si possono
// provare.
//
// La regola che conta: NESSUN `domain`. Senza, il browser lega il cookie all'host da cui è
// arrivata la risposta — `localhost`, `10.50.193.83`, un nome mDNS — e lo rimanda solo lì. Con un
// dominio scritto a mano il cookie funzionerebbe da un indirizzo e da un altro sparirebbe, e il
// sintomo sarebbe «il login non salva la sessione» senza nessun errore da nessuna parte.
// `secure` solo in produzione: sull'iPad in HTTP semplice un cookie Secure viene scartato in
// silenzio. `sameSite: 'lax'` basta per un'app che chiama le proprie API dalla propria origine.

export interface SessionCookieOptions {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: '/';
  readonly expires?: Date;
  readonly maxAge?: number;
}

/** Cookie di sessione valido fino a `expiresAt`. */
export function sessionCookieOptions(
  name: string,
  token: string,
  expiresAt: string,
  nodeEnv: string,
): SessionCookieOptions {
  return {
    name,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: nodeEnv === 'production',
    path: '/',
    expires: new Date(expiresAt),
  };
}

/** Lo stesso cookie, svuotato e già scaduto: è come lo si cancella. */
export function clearedSessionCookieOptions(name: string): SessionCookieOptions {
  return {
    name,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 0,
  };
}
