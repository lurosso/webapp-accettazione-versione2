// Mock del DMS Infinity: agenda giornaliera finta ma DETERMINISTICA dato
// (seed, businessDate, numero di chiamata) con modalità di guasto configurabili.
// Restituisce DTO (forma wire), mai tipi di dominio; non lancia mai: sempre ProviderResult.

import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import { err, ok } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { normalizePlate } from '@/domain/value-objects/plate';
import { addMinutes, buildLocalDateTime } from '@/lib/dates';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '../dto/infinity.dto';
import type { CallOptions, HealthStatus, ProviderError, ProviderResult } from '../interfaces/common';
import { providerError } from '../interfaces/common';
import type { IClock } from '../interfaces/IClock';
import type { IInfinityService } from '../interfaces/IInfinityService';
import type { ILogger } from '../interfaces/ILogger';
import type { InfinityMockMode } from '../interfaces/mock-config';
import { FALLBACK_MODEL, MOCK_BRAND_MODELS } from './data/brands-models';
import { FIRST_NAMES, LAST_NAMES } from './data/italian-names';
import { FAILURE_SUFFIXES, generateItalianMobile } from './data/phones';
import { generateItalianPlate, generateVin } from './data/plates';
import { SeededRandom, seedFrom } from './data/seeded-random';
import { elapsedMs, isAborted, simulateLatency } from './simulate';

/** Modalità di funzionamento del mock (env MOCK_INFINITY_MODE); definita in interfaces/mock-config. */
export type { InfinityMockMode } from '../interfaces/mock-config';

/** Opzioni del mock. */
export interface InfinityMockOptions {
  readonly seed: string;
  readonly mode: InfinityMockMode;
  readonly latencyMs: number;
  /** In modalità flaky: numero di chiamate iniziali che falliscono. */
  readonly flakyFailures: number;
  /**
   * Se true (default in env), ~5 % degli appuntamenti risulta `cancelled` dalla seconda
   * chiamata dello stesso giorno, per esercitare la reconciliation. Con false l'agenda è
   * identica a ogni chiamata (test di determinismo puro).
   */
  readonly cancelOnSecondCall: boolean;
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  /** Fuso della concessionaria (default Europe/Rome). */
  readonly timeZone?: string;
}

/** Dipendenze iniettate. */
export interface InfinityMockDeps {
  readonly clock: IClock;
  readonly logger: ILogger;
}

/** Finestra dell'agenda finta: slot ogni 15 minuti dalle 07:30 alle 12:00. */
const AGENDA_START = '07:30';
const SLOT_MINUTES = 15;
const SLOT_COUNT = 19; // 07:30 → 12:00 inclusi
const MIN_APPOINTMENTS = 28;
const MAX_APPOINTMENTS = 40;
const MAX_PER_SLOT = 3;
const DEFAULT_TIMEOUT_MS = 5000;

/** Descrizioni intervento plausibili. */
const SERVICE_DESCRIPTIONS: readonly (string | null)[] = [
  'Tagliando programmato',
  'Cambio olio e filtri',
  'Sostituzione pneumatici',
  'Controllo freni',
  'Richiamo ufficiale',
  'Diagnosi spia motore',
  'Revisione periodica',
  'Aggiornamento software',
  null,
];

interface GeneratedAppointment {
  readonly dto: InfinityAppointmentDto;
  /** Diventa `cancelled` dalla seconda chiamata dello stesso giorno (reconciliation). */
  readonly cancelOnSecondCall: boolean;
}

/** Agenda finta deterministica con guasti simulati. */
export class InfinityServiceMock implements IInfinityService {
  readonly name = 'INFINITY' as const;

  private readonly logger: ILogger;
  private readonly callsPerDate = new Map<string, number>();
  private flakyRemaining: number;

  constructor(
    private readonly options: InfinityMockOptions,
    private readonly deps: InfinityMockDeps,
  ) {
    this.logger = deps.logger.child('[MOCK][Infinity]');
    this.flakyRemaining = Math.max(0, options.flakyFailures);
  }

  async fetchDailyAgenda(
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAgendaDto>> {
    const started = this.deps.clock.now();
    const failure = await this.simulateFailure(options);
    if (failure !== null) {
      this.logger.warn('fetchDailyAgenda fallita (simulata)', {
        businessDate,
        mode: this.options.mode,
        code: failure.code,
        correlationId: options?.correlationId ?? null,
      });
      return err(failure);
    }

    const callNo = (this.callsPerDate.get(businessDate) ?? 0) + 1;
    this.callsPerDate.set(businessDate, callNo);
    const applyCancellations = this.options.cancelOnSecondCall && callNo >= 2;

    let appointments = this.generate(businessDate).map((g) =>
      applyCancellations && g.cancelOnSecondCall ? { ...g.dto, cancelled: true } : g.dto,
    );
    let partial = false;
    if (this.options.mode === 'empty') {
      appointments = [];
    } else if (this.options.mode === 'partial') {
      appointments = appointments.slice(0, Math.ceil(appointments.length / 2));
      partial = true;
    }

    const agenda: InfinityAgendaDto = {
      businessDate,
      fetchedAt: this.deps.clock.nowIso(),
      partial,
      appointments,
    };
    this.logger.info('fetchDailyAgenda', {
      businessDate,
      count: appointments.length,
      cancelled: appointments.filter((a) => a.cancelled).length,
      mode: this.options.mode,
      latencyMs: elapsedMs(started, this.deps.clock.now()),
      callNo,
      correlationId: options?.correlationId ?? null,
    });
    return ok(agenda);
  }

  async fetchAppointmentByPlate(
    plate: string,
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAppointmentDto | null>> {
    const failure = await this.simulateFailure(options);
    if (failure !== null) {
      return err(failure);
    }
    const wanted = normalizePlate(plate);
    const found = this.generate(businessDate).find((g) => normalizePlate(g.dto.plate) === wanted);
    this.logger.info('fetchAppointmentByPlate', {
      businessDate,
      plate: wanted,
      found: found !== undefined,
    });
    return ok(found?.dto ?? null);
  }

  async healthCheck(): Promise<HealthStatus> {
    const status = ((): HealthStatus['status'] => {
      switch (this.options.mode) {
        case 'error':
        case 'timeout':
          return 'DOWN';
        case 'flaky':
        case 'partial':
          return 'DEGRADED';
        default:
          return 'UP';
      }
    })();
    return {
      provider: 'INFINITY',
      status,
      checkedAt: this.deps.clock.nowIso(),
      // Nessuna chiamata reale misurata: la latenza simulata è riportata in `detail`.
      latencyMs: null,
      detail: `mock mode=${this.options.mode}, latenza simulata=${this.options.latencyMs} ms`,
      implementation: 'mock',
    };
  }

  /**
   * Agenda deterministica della giornata: 28-40 appuntamenti su 19 slot (07:30-12:00),
   * 1-3 per slot; ~10% senza telefono, ~15% senza opt-in WhatsApp, ~5% con suffisso
   * telefonico forzato (7/8/9/99), ~5% marcati per l'annullamento dalla seconda chiamata.
   */
  private generate(businessDate: IsoDate): GeneratedAppointment[] {
    const rng = new SeededRandom(seedFrom(this.options.seed, businessDate));
    const activeBrands = this.options.brands.filter((b) => b.isActive);
    const brands = activeBrands.length > 0 ? activeBrands : this.options.brands;
    if (brands.length === 0) {
      return [];
    }

    const target = rng.int(MIN_APPOINTMENTS, MAX_APPOINTMENTS);
    const perSlot: number[] = new Array<number>(SLOT_COUNT).fill(1);
    let remaining = target - SLOT_COUNT;
    while (remaining > 0) {
      const slot = rng.int(0, SLOT_COUNT - 1);
      const current = perSlot[slot] ?? 1;
      if (current < MAX_PER_SLOT) {
        perSlot[slot] = current + 1;
        remaining -= 1;
      }
    }

    const timeZone = this.options.timeZone ?? 'Europe/Rome';
    const slotStart = buildLocalDateTime(businessDate, AGENDA_START, timeZone);
    const compactDate = businessDate.replace(/-/g, '');
    const updatedAt = buildLocalDateTime(businessDate, '05:45', timeZone);
    const usedPlates = new Set<string>();
    const out: GeneratedAppointment[] = [];
    let n = 0;

    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const scheduledAt = addMinutes(slotStart, slot * SLOT_MINUTES);
      const count = perSlot[slot] ?? 1;
      for (let k = 0; k < count; k += 1) {
        n += 1;
        const sequence = String(n).padStart(4, '0');
        const brand = rng.pick(brands);
        const models = MOCK_BRAND_MODELS[brand.code] ?? [FALLBACK_MODEL];
        let plate = generateItalianPlate(rng);
        while (usedPlates.has(plate)) {
          plate = generateItalianPlate(rng);
        }
        usedPlates.add(plate);

        const hasPhone = !rng.chance(0.1);
        const forcedSuffix = hasPhone && rng.chance(0.05) ? rng.pick(FAILURE_SUFFIXES) : undefined;
        const phone = hasPhone ? generateItalianMobile(rng, forcedSuffix) : null;
        const optIn: boolean | null = rng.chance(0.15) ? false : rng.chance(0.05) ? null : true;
        const desk = this.options.desks.find((d) => d.brandIds.includes(brand.id));
        const firstName = rng.pick(FIRST_NAMES);
        const lastName = rng.pick(LAST_NAMES);

        const dto: InfinityAppointmentDto = {
          externalId: `INF-${compactDate}-${sequence}`,
          scheduledAt,
          brandCode: brand.code,
          plate,
          vin: rng.chance(0.7) ? generateVin(rng) : null,
          vehicleModel: rng.pick(models),
          customer: {
            // Derivato dal progressivo: univoco nell'agenda (un cliente per appuntamento).
            externalId: `CUST-${compactDate}-${sequence}`,
            firstName,
            lastName,
            phone,
            email: rng.chance(0.6)
              ? `${firstName}.${lastName}@example.it`.toLowerCase().replace(/[\s']/g, '')
              : null,
            whatsappOptIn: optIn,
          },
          serviceDescription: rng.pick(SERVICE_DESCRIPTIONS),
          deskCode: desk?.code ?? null,
          cancelled: false,
          updatedAt,
        };
        out.push({ dto, cancelOnSecondCall: rng.chance(0.05) });
      }
    }
    return out;
  }

  /** Applica la modalità di guasto; `null` se la chiamata deve riuscire. */
  private async simulateFailure(options: CallOptions | undefined): Promise<ProviderError | null> {
    const signal = options?.signal;
    if (isAborted(signal)) {
      return providerError('INFINITY', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true);
    }

    if (this.options.mode === 'timeout') {
      const waitMs = (options?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 50;
      await simulateLatency(waitMs, signal);
      return providerError(
        'INFINITY',
        'TIMEOUT',
        `Infinity non ha risposto entro ${options?.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms (simulato).`,
        true,
      );
    }

    const completed = await simulateLatency(this.options.latencyMs, signal);
    if (!completed) {
      return providerError('INFINITY', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true);
    }

    if (this.options.mode === 'error') {
      return providerError(
        'INFINITY',
        'PROVIDER_ERROR',
        'Infinity ha restituito un errore interno (simulato).',
        false,
      );
    }
    if (this.options.mode === 'flaky' && this.flakyRemaining > 0) {
      this.flakyRemaining -= 1;
      return providerError(
        'INFINITY',
        'NETWORK',
        `Connessione a Infinity interrotta (simulato, ${this.flakyRemaining} guasti residui).`,
        true,
      );
    }
    return null;
  }
}
