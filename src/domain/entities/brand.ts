// Marchio (brand) gestito dalla concessionaria multimarca.

import type { BrandId } from '../ids';

/** Marchio: filtro della dashboard e (con CODE_SEQUENCE_SCOPE=BRAND) prefisso del codice. */
export interface Brand {
  readonly id: BrandId;
  /** Codice stabile in maiuscolo, es. "FIAT", "ALFA_ROMEO". */
  readonly code: string;
  /** Nome leggibile, es. "Alfa Romeo". */
  readonly name: string;
  /** Prefisso del codice progressivo usato solo con la strategia per brand (es. "F"). */
  readonly codePrefix: string;
  /** Token colore per la UI (classe/tema), es. "brand-fiat". */
  readonly colorToken: string;
  readonly isActive: boolean;
}

/**
 * Codice del marchio di ripiego («Altri marchi»): il mapper vi assegna le prenotazioni di marche non
 * in elenco (Hyundai, Foton…), così una pratica non viene mai scartata per il marchio. Esiste solo
 * nei profili di seed che lo prevedono (real); senza, il marchio sconosciuto resta un rifiuto.
 */
export const FALLBACK_BRAND_CODE = 'ALTRO';
