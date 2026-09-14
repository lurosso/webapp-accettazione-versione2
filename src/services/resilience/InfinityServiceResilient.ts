// Decoratore di resilienza per la porta Infinity: timeout esplicito, ripetizione sugli errori di
// rete e interruttore di circuito. Avvolge QUALUNQUE implementazione (oggi il mock, domani
// l'adapter HTTP) esponendo la stessa interfaccia: chi usa `IInfinityService` non sa che c'è.
//
// Perché un decoratore e non codice dentro `SyncService`: la regola "non martellare un DMS che
// non risponde" riguarda la porta, non il caso d'uso. Messa qui vale anche per la ricerca per
// targa e per l'health check, e quando arriverà l'adapter reale non andrà riscritta.
import { err } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '../dto/infinity.dto';
import type { CallOptions, HealthStatus, ProviderResult } from '../interfaces/common';
import { providerError } from '../interfaces/common';
import type { IClock } from '../interfaces/IClock';
import type { IInfinityService } from '../interfaces/IInfinityService';
import type { ILogger } from '../interfaces/ILogger';
import { CircuitBreaker } from './circuit-breaker';
import { withRetry } from './retry';

export interface InfinityResilienceOptions {
  /** Tempo massimo per una singola chiamata (ms). */
  readonly timeoutMs: number;
  /** Ripetizioni sugli errori ritentabili, oltre al primo tentativo. */
  readonly retries: number;
  /** Attesa base fra le ripetizioni (ms). */
  readonly retryBaseDelayMs: number;
  /** Guasti consecutivi che aprono il circuito. */
  readonly failureThreshold: number;
  /** Per quanto il circuito resta aperto prima della chiamata di prova (ms). */
  readonly openForMs: number;
  /** Cosa c'è dietro il decoratore, per l'health check quando il circuito è aperto. */
  readonly implementation: HealthStatus['implementation'];
}

export interface InfinityResilienceDeps {
  readonly clock: IClock;
  readonly logger: ILogger;
  /** Attesa iniettabile per i test. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

export class InfinityServiceResilient implements IInfinityService {
  readonly name = 'INFINITY' as const;

  private readonly breaker: CircuitBreaker;
  private readonly logger: ILogger;

  constructor(
    private readonly inner: IInfinityService,
    private readonly options: InfinityResilienceOptions,
    private readonly deps: InfinityResilienceDeps,
  ) {
    this.logger = deps.logger.child('[Infinity][Resilienza]');
    this.breaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold,
      openForMs: options.openForMs,
      now: () => deps.clock.now().getTime(),
    });
  }

  fetchDailyAgenda(
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAgendaDto>> {
    return this.guarded(
      'fetchDailyAgenda',
      (opts) => this.inner.fetchDailyAgenda(businessDate, opts),
      options,
    );
  }

  fetchAppointmentByPlate(
    plate: string,
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAppointmentDto | null>> {
    return this.guarded(
      'fetchAppointmentByPlate',
      (opts) => this.inner.fetchAppointmentByPlate(plate, businessDate, opts),
      options,
    );
  }

  /**
   * Lo stato di salute tiene conto del circuito: con l'interruttore aperto Infinity è DOWN per
   * noi anche se il suo health check risponderebbe, perché in questo momento non lo chiamiamo.
   */
  async healthCheck(options?: CallOptions): Promise<HealthStatus> {
    const circuito = this.breaker.snapshot();
    if (circuito.state === 'OPEN') {
      return {
        provider: 'INFINITY',
        status: 'DOWN',
        checkedAt: this.deps.clock.nowIso(),
        latencyMs: null,
        detail: `circuito aperto dopo ${circuito.consecutiveFailures} guasti consecutivi; prossima prova fra ${this.secondsUntil(circuito.retryAt)} s`,
        implementation: this.options.implementation,
      };
    }
    const interno = await this.inner.healthCheck({
      ...options,
      timeoutMs: options?.timeoutMs ?? this.options.timeoutMs,
    });
    return circuito.consecutiveFailures > 0 && interno.status === 'UP'
      ? {
          ...interno,
          status: 'DEGRADED',
          detail: `${interno.detail ?? ''} · ${circuito.consecutiveFailures} guasti recenti`.trim(),
        }
      : interno;
  }

  /** Stato del circuito (per diagnostica e test). */
  circuit(): ReturnType<CircuitBreaker['snapshot']> {
    return this.breaker.snapshot();
  }

  private async guarded<T>(
    operation: string,
    call: (options: CallOptions) => Promise<ProviderResult<T>>,
    options: CallOptions | undefined,
  ): Promise<ProviderResult<T>> {
    if (!this.breaker.allows()) {
      const circuito = this.breaker.snapshot();
      return err(
        providerError(
          'INFINITY',
          'CIRCUIT_OPEN',
          `Infinity non viene chiamato: troppi guasti consecutivi, nuova prova fra ${this.secondsUntil(circuito.retryAt)} s.`,
          true,
        ),
      );
    }

    const opzioni: CallOptions = {
      ...options,
      timeoutMs: options?.timeoutMs ?? this.options.timeoutMs,
    };
    const esito = await withRetry(() => call(opzioni), {
      retries: this.options.retries,
      baseDelayMs: this.options.retryBaseDelayMs,
      maxDelayMs: this.options.timeoutMs,
      signal: options?.signal,
      ...(this.deps.sleep === undefined ? {} : { sleep: this.deps.sleep }),
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
      onRetry: (attempt, error, delayMs) =>
        this.logger.warn(
          `${operation}: ${error.code}, ripeto (tentativo ${attempt + 1}) fra ${delayMs} ms`,
        ),
    });

    if (esito.ok) {
      this.breaker.recordSuccess();
    } else {
      this.breaker.recordFailure(esito.error);
      const circuito = this.breaker.snapshot();
      if (circuito.state === 'OPEN') {
        this.logger.error(
          `${operation}: circuito APERTO dopo ${circuito.consecutiveFailures} guasti; Infinity non sarà chiamato per ${Math.round(this.options.openForMs / 1000)} s`,
        );
      }
    }
    return esito;
  }

  private secondsUntil(retryAt: number | null): number {
    if (retryAt === null) {
      return 0;
    }
    return Math.max(0, Math.ceil((retryAt - this.deps.clock.now().getTime()) / 1000));
  }
}
