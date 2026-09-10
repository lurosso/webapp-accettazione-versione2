// Generatore di UUID v4 tramite Web Crypto (`globalThis.crypto.randomUUID`), disponibile
// in tutti i runtime target (Node 19+, browser moderni). Nessun fallback su Date.now():
// l'ora corrente passa solo da IClock e un id non riproducibile "silenzioso" nasconderebbe bug.

import { ConfigurationError } from '@/domain/errors';
import type { IIdGenerator } from '../interfaces/IIdGenerator';

interface CryptoLike {
  readonly randomUUID?: () => string;
}

/** UUID v4 da `globalThis.crypto.randomUUID()`; fallisce all'avvio se il runtime non lo espone. */
export class UuidIdGenerator implements IIdGenerator {
  private readonly randomUUID: () => string;

  constructor() {
    const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto;
    if (cryptoApi === undefined || typeof cryptoApi.randomUUID !== 'function') {
      throw new ConfigurationError(
        'Il runtime non espone crypto.randomUUID(): serve Node.js 19+ o un browser moderno. In alternativa iniettare SequentialIdGenerator (solo test).',
      );
    }
    this.randomUUID = cryptoApi.randomUUID.bind(cryptoApi);
  }

  next(): string {
    return this.randomUUID();
  }

  nextAs<T extends string>(brand: (v: string) => T): T {
    return brand(this.next());
  }
}
