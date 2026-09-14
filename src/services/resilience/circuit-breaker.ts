// Interruttore di circuito per le porte esterne.
//
// Quando un sistema esterno è giù, continuare a chiamarlo ogni pochi secondi non lo fa tornare su:
// allunga solo i tempi di risposta dell'officina (ogni chiamata aspetta il proprio timeout) e, nel
// caso di un DMS già in difficoltà, gli aggiunge carico. L'interruttore conta i guasti; oltre la
// soglia si "apre" e per un periodo risponde subito con CIRCUIT_OPEN senza chiamare nessuno; poi
// lascia passare una sola chiamata di prova (semi-aperto): se va bene richiude, altrimenti riapre.
//
// Non dipende dall'orologio di sistema: riceve `now()` dal chiamante (IClock), così i test lo
// governano e in produzione segue lo stesso orologio del resto dell'applicazione.
import type { ProviderError } from '../interfaces/common';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Guasti consecutivi che aprono il circuito. */
  readonly failureThreshold: number;
  /** Per quanto resta aperto prima di concedere una chiamata di prova (ms). */
  readonly openForMs: number;
  /** Sorgente del tempo. */
  readonly now: () => number;
  /** Quali errori contano come guasto del sistema (default: solo quelli ritentabili, cioè di rete). */
  readonly countsAsFailure?: (error: ProviderError) => boolean;
}

export interface CircuitSnapshot {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  /** Istante (ms) in cui il circuito potrà essere riprovato; null se chiuso. */
  readonly retryAt: number | null;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {}

  /** True se una chiamata può partire adesso (chiuso, oppure aperto ma con la prova concessa). */
  allows(): boolean {
    if (this.state === 'CLOSED') {
      return true;
    }
    if (this.state === 'OPEN') {
      const scaduto =
        this.openedAt !== null && this.options.now() - this.openedAt >= this.options.openForMs;
      if (!scaduto) {
        return false;
      }
      // Una sola chiamata di prova: se ne partissero dieci, un sistema appena ripartito
      // verrebbe travolto proprio nel momento più delicato.
      this.state = 'HALF_OPEN';
      return true;
    }
    // HALF_OPEN: la prova è già in corso, le altre aspettano l'esito.
    return false;
  }

  /** Esito positivo: il circuito si richiude e il conteggio riparte da zero. */
  recordSuccess(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  /**
   * Esito negativo. Gli errori "del chiamante" (richiesta non valida, non trovato) non aprono il
   * circuito: il sistema esterno funziona, siamo noi ad aver chiesto male.
   */
  recordFailure(error: ProviderError): void {
    const conta = this.options.countsAsFailure ?? ((e: ProviderError) => e.retryable);
    if (!conta(error)) {
      return;
    }
    this.consecutiveFailures += 1;
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.options.now();
    }
  }

  snapshot(): CircuitSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      retryAt:
        this.state === 'OPEN' && this.openedAt !== null
          ? this.openedAt + this.options.openForMs
          : null,
    };
  }
}
