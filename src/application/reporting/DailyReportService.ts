// Riepilogo della giornata per il responsabile (M7): quanto si è aspettato, quanto è durata
// l'accettazione, quante pratiche si sono chiuse bene e quante no.
//
// I numeri sono calcolati dalle pratiche, non accumulati in contatori a parte: un contatore che
// si aggiorna a ogni azione prima o poi diverge dalla realtà (un riavvio, un'azione fallita a
// metà), mentre la giornata ricalcolata è sempre d'accordo con quello che si vede in coda.
//
// Le medie si fanno solo sulle pratiche che hanno davvero i due istanti richiesti: una pratica
// mai presa in carico non ha un tempo di attesa "infinito", semplicemente non entra nella media,
// e il conteggio di quante ne sono entrate viaggia insieme al numero perché una media su tre
// pratiche non vale come una media su trenta.
import {
  effectiveScheduleTime,
  isAutoClosedPending,
  type Appointment,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type {
  IAppointmentRepository,
  IMediaRepository,
  IOperatorRepository,
  IReferenceDataRepository,
} from '@/repositories/interfaces';
import type { ILogger } from '@/services/interfaces/ILogger';

export interface DailyReportServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
  readonly media: IMediaRepository;
  readonly logger: ILogger;
}

/** Media in minuti e su quante pratiche è stata calcolata. */
export interface AverageMinutes {
  readonly minutes: number | null;
  readonly sampleSize: number;
}

/** Una riga della tabella per sportello. */
export interface DeskDayView {
  readonly deskId: string | null;
  /** «A — Fiat, Lancia». `null` per le pratiche senza sportello assegnato. */
  readonly label: string;
  readonly expected: number;
  readonly completed: number;
  readonly noShow: number;
  readonly averageWaitMinutes: number | null;
  /** Ancora da servire adesso: in attesa, saltate, in carico. */
  readonly stillInQueue: number;
}

export interface DailyReportView {
  readonly businessDate: string;
  readonly total: number;
  readonly counts: Readonly<Record<AppointmentStatus, number>>;
  /** Percentuali sul totale della giornata, arrotondate a un decimale. */
  readonly rates: {
    readonly completed: number;
    readonly noShow: number;
    readonly cancelled: number;
  };
  /** Dall'orario atteso (agenda o rimessa in coda) alla presa in carico. */
  readonly averageWait: AverageMinutes;
  /** Dalla presa in carico alla chiusura dell'accettazione. */
  readonly averageService: AverageMinutes;
  /** Attesa più lunga della giornata, per capire se la media nasconde un caso limite. */
  readonly longestWaitMinutes: number | null;
  /** Pratiche ancora aperte (in coda o in carico): la giornata non è finita. */
  readonly stillOpen: number;
  /**
   * La stessa giornata divisa per sportello. Il totale dice com'è andata l'officina; questa dice
   * DOVE è andata storta, che è la domanda successiva e finora si rispondeva aprendo il CSV.
   */
  readonly byDesk: readonly DeskDayView[];
}

const ZERO_COUNTS: Readonly<Record<AppointmentStatus, number>> = {
  WAITING: 0,
  IN_PROGRESS: 0,
  COMPLETED: 0,
  SKIPPED: 0,
  NO_SHOW: 0,
  CANCELLED: 0,
};

/** Minuti fra due istanti ISO; null se uno dei due manca o l'ordine è invertito. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) {
    return null;
  }
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 60_000 : null;
}

function average(values: readonly number[]): AverageMinutes {
  if (values.length === 0) {
    return { minutes: null, sampleSize: 0 };
  }
  const somma = values.reduce((acc, v) => acc + v, 0);
  return { minutes: Math.round((somma / values.length) * 10) / 10, sampleSize: values.length };
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

/** Una riga del CSV: già formattata, così il Route Handler non fa altro che servirla. */
function csvRow(values: readonly (string | number | null)[]): string {
  return values
    .map((v) => {
      if (v === null) {
        return '';
      }
      const testo = String(v);
      // Punto e virgola, virgolette e a capo dentro un campo: si racchiude fra virgolette.
      return /[";\n\r]/.test(testo) ? `"${testo.replace(/"/g, '""')}"` : testo;
    })
    .join(';');
}

const CSV_HEADERS = [
  'Codice',
  'Orario agenda',
  'Orario effettivo',
  'Targa',
  'Marca',
  'Modello',
  'Cliente',
  'Telefono',
  'Sportello',
  'Accettazione',
  'Stato',
  'Operatore',
  'Presa in carico',
  'Chiusa',
  'Attesa (min)',
  'Lavorazione (min)',
  'Foto',
  'Note',
] as const;

/** Stati in italiano, come nella dashboard: il report lo legge chi usa l'applicazione. */
const STATO_IT: Readonly<Record<AppointmentStatus, string>> = {
  WAITING: 'In attesa',
  IN_PROGRESS: 'In carico',
  COMPLETED: 'Completata',
  SKIPPED: 'Saltata',
  NO_SHOW: 'Assente',
  CANCELLED: 'Annullata',
};

export class DailyReportService {
  private readonly logger: ILogger;

  constructor(private readonly deps: DailyReportServiceDeps) {
    this.logger = deps.logger.child('[Report]');
  }

  /**
   * Indicatori della giornata, calcolati dalle pratiche.
   * Le annullate vanno chieste esplicitamente (`includeCancelled`): di norma la coda le nasconde,
   * ma in un riepilogo di fine giornata sono parte dell'esito e vanno contate.
   */
  async getDailyReport(businessDate: IsoDate): Promise<DailyReportView> {
    const [pratiche, desks, brands] = await Promise.all([
      this.deps.appointments.listByDate(businessDate, { includeCancelled: true }),
      this.deps.referenceData.listDesks(),
      this.deps.referenceData.listBrands(),
    ]);

    const counts: Record<AppointmentStatus, number> = { ...ZERO_COUNTS };
    const attese: number[] = [];
    const lavorazioni: number[] = [];
    for (const a of pratiche) {
      counts[a.status] += 1;
      const attesa = minutesBetween(effectiveScheduleTime(a), a.takenAt);
      if (attesa !== null) {
        attese.push(attesa);
      }
      const lavorazione = minutesBetween(a.takenAt, a.completedAt);
      if (lavorazione !== null) {
        lavorazioni.push(lavorazione);
      }
    }

    // Per sportello: stessi conti, raggruppati. Le pratiche senza sportello finiscono in una riga
    // a parte invece di sparire — sono quelle che nessuno ha ancora preso, e vederle è il punto.
    const perSportello = new Map<string, { attese: number[]; pratiche: Appointment[] }>();
    for (const a of pratiche) {
      const chiave = a.deskId ?? '';
      const gruppo = perSportello.get(chiave) ?? { attese: [], pratiche: [] };
      gruppo.pratiche.push(a);
      const attesa = minutesBetween(effectiveScheduleTime(a), a.takenAt);
      if (attesa !== null) {
        gruppo.attese.push(attesa);
      }
      perSportello.set(chiave, gruppo);
    }
    const byDesk: DeskDayView[] = [...perSportello.entries()]
      .map(([chiave, gruppo]) => {
        const desk = desks.find((d) => d.id === chiave) ?? null;
        const marchi =
          desk === null
            ? []
            : desk.brandIds.map((id) => brands.find((b) => b.id === id)?.name ?? id);
        return {
          deskId: chiave === '' ? null : chiave,
          label:
            desk === null
              ? 'Senza sportello'
              : marchi.length === 0
                ? desk.code
                : `${desk.code} — ${marchi.join(', ')}`,
          expected: gruppo.pratiche.length,
          completed: gruppo.pratiche.filter((a) => a.status === 'COMPLETED').length,
          noShow: gruppo.pratiche.filter((a) => a.status === 'NO_SHOW').length,
          averageWaitMinutes: average(gruppo.attese).minutes,
          stillInQueue: gruppo.pratiche.filter(
            (a) => a.status === 'WAITING' || a.status === 'SKIPPED' || a.status === 'IN_PROGRESS',
          ).length,
        };
      })
      .sort((x, y) => x.label.localeCompare(y.label, 'it'));

    const total = pratiche.length;
    return {
      businessDate,
      byDesk,
      total,
      counts,
      rates: {
        completed: percent(counts.COMPLETED, total),
        noShow: percent(counts.NO_SHOW, total),
        cancelled: percent(counts.CANCELLED, total),
      },
      averageWait: average(attese),
      averageService: average(lavorazioni),
      longestWaitMinutes: attese.length === 0 ? null : Math.round(Math.max(...attese) * 10) / 10,
      stillOpen: counts.WAITING + counts.SKIPPED + counts.IN_PROGRESS,
    };
  }

  /**
   * Riepilogo dettagliato in CSV. Separatore `;` e virgola decimale: è il formato che Excel in
   * italiano apre con un doppio clic, ed è lì che finirà il file.
   */
  async buildDailyCsv(businessDate: IsoDate): Promise<string> {
    const [pratiche, brands, desks, bays] = await Promise.all([
      this.deps.appointments.listByDate(businessDate, { includeCancelled: true }),
      this.deps.referenceData.listBrands(),
      this.deps.referenceData.listDesks(),
      this.deps.referenceData.listBays(),
    ]);

    const righe: string[] = [csvRow([...CSV_HEADERS])];
    for (const a of [...pratiche].sort((x, y) => x.sequence - y.sequence)) {
      const operatore =
        a.operatorId === null
          ? null
          : ((await this.deps.operators.findById(a.operatorId))?.displayName ?? null);
      const foto = await this.deps.media.listByAppointment(a.id);
      const attesa = minutesBetween(effectiveScheduleTime(a), a.takenAt);
      const lavorazione = minutesBetween(a.takenAt, a.completedAt);
      const chiusa = a.completedAt ?? a.noShowAt ?? a.cancelledAt;

      righe.push(
        csvRow([
          a.code,
          this.time(a.scheduledAt),
          this.time(effectiveScheduleTime(a)),
          a.vehicle.plate,
          brands.find((b) => b.id === a.vehicle.brandId)?.name ?? '',
          a.vehicle.model,
          customerFullName(a.customer),
          a.customer.phone,
          desks.find((d) => d.id === a.deskId)?.code ?? '',
          bays.find((b) => b.id === a.bayId)?.code ?? '',
          isAutoClosedPending(a)
            ? "Completata (chiusa d'ufficio, da confermare)"
            : STATO_IT[a.status],
          operatore,
          this.time(a.takenAt),
          this.time(chiusa),
          this.decimal(attesa),
          this.decimal(lavorazione),
          foto.length,
          a.notes,
        ]),
      );
    }

    this.logger.info('report giornaliero esportato', {
      giornata: businessDate,
      pratiche: pratiche.length,
    });
    // Ritorno a capo CRLF: è quello che Excel si aspetta in un CSV.
    return righe.join('\r\n');
  }

  /** Nome del file proposto allo scaricamento. */
  csvFileName(businessDate: IsoDate): string {
    return `accettazione-${businessDate}.csv`;
  }

  private time(iso: string | null): string {
    if (iso === null) {
      return '';
    }
    // Orario locale dell'officina in forma leggibile; la data è nel nome del file.
    return new Date(iso).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Rome',
    });
  }

  private decimal(minutes: number | null): string {
    return minutes === null ? '' : (Math.round(minutes * 10) / 10).toFixed(1).replace('.', ',');
  }
}
