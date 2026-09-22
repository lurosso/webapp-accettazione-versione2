// Diagnostica della pagina Sistema: una riga per ogni cosa che può fermare l'officina, con lo
// stato, un dettaglio leggibile e un CODICE da mettere nella segnalazione all'amministratore.
//
// Alle quattro porte esterne (Infinity, Spoki, SMS, CRM) si aggiungono lo storage dei media (si
// scrive, si rilegge e si cancella davvero una sonda: se il disco è pieno o in sola lettura lo si
// scopre qui e non al primo video) e la sincronizzazione dell'agenda (l'ultima esecuzione di
// oggi e com'è andata). La rete la misura il browser, che è l'unico a sapere se è collegato.
import { checkExternalHealth, type ExternalHealthPorts } from '@/application/health/check-health';
import type { SystemAlertComponent } from '@/domain/entities/system-alert';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { ISyncRunRepository } from '@/repositories/interfaces';
import type { HealthStatus, ProviderName } from '@/services/interfaces/common';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { IMediaStorage } from '@/services/interfaces/IMediaStorage';
import type { ProviderKind } from '@/services/interfaces/provider-kinds';

export interface SystemDiagnosticsDeps {
  readonly external: ExternalHealthPorts;
  readonly kinds: Readonly<Record<ProviderName, ProviderKind>>;
  readonly mediaStorage: IMediaStorage;
  readonly syncRuns: ISyncRunRepository;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly timeZone: string;
}

export type DiagnosticStatus = HealthStatus['status'];

/** Una riga della diagnostica, com'è mostrata e com'è segnalata. */
export interface DiagnosticRowView {
  readonly component: SystemAlertComponent;
  readonly label: string;
  readonly status: DiagnosticStatus;
  /** Codice da segnalare quando qualcosa non va; null quando è tutto a posto. */
  readonly code: string | null;
  readonly detail: string | null;
  readonly latencyMs: number | null;
  readonly implementation: 'mock' | 'real' | null;
}

export interface SystemDiagnosticsView {
  readonly checkedAt: IsoDateTime;
  readonly overall: 'UP' | 'DEGRADED' | 'DOWN';
  readonly rows: readonly DiagnosticRowView[];
}

const PROVIDER_COMPONENT: Readonly<Record<ProviderName, SystemAlertComponent>> = {
  INFINITY: 'INFINITY',
  SPOKI: 'SPOKI',
  SMS_HOSTING: 'SMS_HOSTING',
  CRM: 'CRM',
};

const PROVIDER_LABEL: Readonly<Record<ProviderName, string>> = {
  INFINITY: 'Infinity DMS (agenda)',
  SPOKI: 'Spoki (WhatsApp)',
  SMS_HOSTING: 'SMS Hosting (SMS di ripiego)',
  CRM: 'CRM / BDC (webhook)',
};

/** Sotto questa soglia di spazio libero lo storage è «degradato»: ancora funziona, ma per poco. */
export const LOW_DISK_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

function gigabyte(bytes: number): string {
  return `${(bytes / 1024 ** 3).toLocaleString('it-IT', { maximumFractionDigits: 1 })} GB`;
}

function overallOf(rows: readonly DiagnosticRowView[]): SystemDiagnosticsView['overall'] {
  if (rows.some((r) => r.status === 'DOWN')) {
    return 'DOWN';
  }
  if (rows.some((r) => r.status !== 'UP')) {
    return 'DEGRADED';
  }
  return 'UP';
}

export class SystemDiagnosticsService {
  private readonly logger: ILogger;

  constructor(private readonly deps: SystemDiagnosticsDeps) {
    this.logger = deps.logger.child('[Diagnostica]');
  }

  async run(correlationId?: string): Promise<SystemDiagnosticsView> {
    const [porte, storage, sync] = await Promise.all([
      this.portaEsterne(correlationId),
      this.storageMedia(),
      this.sincronizzazione(),
    ]);
    const rows = [...porte, storage, sync];
    return { checkedAt: this.deps.clock.nowIso(), overall: overallOf(rows), rows };
  }

  private async portaEsterne(correlationId?: string): Promise<readonly DiagnosticRowView[]> {
    const health = await checkExternalHealth(this.deps.external, {
      clock: this.deps.clock,
      kinds: this.deps.kinds,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return health.providers.map((p) => ({
      component: PROVIDER_COMPONENT[p.provider],
      label: PROVIDER_LABEL[p.provider],
      status: p.status,
      code: p.status === 'UP' ? null : `${p.provider}-${p.status}`,
      detail: p.detail,
      latencyMs: p.latencyMs,
      implementation: p.implementation,
    }));
  }

  /** Scrive, rilegge e cancella una sonda: la prova più onesta che il disco c'è e si può usare. */
  private async storageMedia(): Promise<DiagnosticRowView> {
    const base = {
      component: 'MEDIA_STORAGE' as const,
      label: 'Storage media / disco',
      implementation: null,
    };
    const inizio = this.deps.clock.now().getTime();
    const key = `diagnostica/sonda-${this.deps.ids.next()}.txt`;
    const bytes = new TextEncoder().encode('sonda');
    const scritta = await this.deps.mediaStorage.put({ key, bytes, mimeType: 'text/plain' });
    if (!scritta.ok) {
      this.logger.error('storage media: scrittura fallita', { errore: scritta.error.message });
      return {
        ...base,
        status: 'DOWN',
        code: 'MEDIA_STORAGE-WRITE',
        detail: `Scrittura fallita: ${scritta.error.message}`,
        latencyMs: null,
      };
    }
    const riletta = await this.deps.mediaStorage.read(scritta.value.key);
    await this.deps.mediaStorage.delete(scritta.value.key);
    const latencyMs = Math.max(0, this.deps.clock.now().getTime() - inizio);
    if (!riletta.ok || riletta.value.bytes.byteLength !== bytes.byteLength) {
      return {
        ...base,
        status: 'DOWN',
        code: 'MEDIA_STORAGE-READ',
        detail: 'Il file scritto non si rilegge: disco o cartella danneggiati.',
        latencyMs,
      };
    }
    const stats =
      this.deps.mediaStorage.stats === undefined ? null : await this.deps.mediaStorage.stats();
    if (stats !== null && stats.freeBytes !== null && stats.freeBytes < LOW_DISK_SPACE_BYTES) {
      return {
        ...base,
        status: 'DEGRADED',
        code: 'MEDIA_STORAGE-LOW-SPACE',
        detail: `Spazio libero quasi finito: ${gigabyte(stats.freeBytes)}${stats.totalBytes === null ? '' : ` su ${gigabyte(stats.totalBytes)}`}.`,
        latencyMs,
      };
    }
    const spazio =
      stats === null || stats.freeBytes === null
        ? ''
        : ` · libero ${gigabyte(stats.freeBytes)}${stats.totalBytes === null ? '' : ` su ${gigabyte(stats.totalBytes)}`}`;
    return {
      ...base,
      status: 'UP',
      code: null,
      detail: `Scrittura e lettura in ${latencyMs} ms${spazio}`,
      latencyMs,
    };
  }

  /** L'ultima sincronizzazione della giornata e com'è andata. */
  private async sincronizzazione(): Promise<DiagnosticRowView> {
    const base = {
      component: 'SYNC' as const,
      label: 'Sincronizzazione agenda (Infinity)',
      implementation: null,
      latencyMs: null,
    };
    const ultima = await this.deps.syncRuns.findLatest(this.deps.clock.today());
    if (ultima === null) {
      return {
        ...base,
        status: 'UNKNOWN',
        code: 'SYNC-NONE',
        detail: 'Nessuna sincronizzazione oggi: la coda potrebbe non avere l’agenda.',
      };
    }
    const ora = new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: this.deps.timeZone,
    }).format(new Date(ultima.finishedAt ?? ultima.startedAt));
    switch (ultima.status) {
      case 'RUNNING':
        return { ...base, status: 'UP', code: null, detail: `In corso dalle ${ora}.` };
      case 'SUCCESS':
        return {
          ...base,
          status: 'UP',
          code: null,
          detail: `Riuscita alle ${ora}: ${ultima.counters.fetched} pratiche lette, ${ultima.counters.created} nuove, ${ultima.counters.updated} aggiornate.`,
        };
      case 'PARTIAL':
        return {
          ...base,
          status: 'DEGRADED',
          code: 'SYNC-PARTIAL',
          detail: `Parziale alle ${ora}: ${ultima.counters.rejected} pratiche rifiutate${ultima.errorMessage === null ? '' : ` · ${ultima.errorMessage}`}.`,
        };
      case 'FAILED':
        return {
          ...base,
          status: 'DOWN',
          code: 'SYNC-FAILED',
          detail: `Fallita alle ${ora}${ultima.errorMessage === null ? '' : `: ${ultima.errorMessage}`}.`,
        };
    }
  }
}
