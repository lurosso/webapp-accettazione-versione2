// Strumenti di assistenza dell'amministratore: cosa è rimasto incagliato e come sbloccarlo.
//
// In questo sistema non esiste uno "sportello bloccato" come stato salvato: un'accettazione è
// occupata perché una pratica è IN_PROGRESS su di essa. Quindi sbloccare un'accettazione e
// liberare una pratica incagliata sono la stessa operazione vista da due lati: si rimette la
// pratica in coda (release) oppure, se il cliente non c'è più, la si annulla. Questa vista mette
// insieme i due lati con i dati che servono a decidere: chi l'aveva presa in carico e da quanto.
import type { Appointment } from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import type {
  IAppointmentRepository,
  IOperatorRepository,
  IReferenceDataRepository,
  IWorkstationClaimRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';

export interface AssistanceServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
  /** Chi è collegato a quale postazione: dice a chi è assegnato uno sportello anche se è fermo. */
  readonly claims: IWorkstationClaimRepository;
  readonly clock: IClock;
}

export interface StuckAppointmentView {
  readonly id: string;
  readonly code: string;
  readonly plate: string;
  readonly customerName: string;
  readonly version: number;
  readonly operatorName: string | null;
  readonly deskCode: string | null;
  readonly bayCode: string | null;
  /** Da quando è in carico. */
  readonly since: IsoDateTime | null;
  readonly minutesInProgress: number;
}

/**
 * Uno dei quattro sportelli fisici visto dall'amministratore: a chi è assegnato e cosa ci sta
 * succedendo adesso. Due informazioni diverse, e vanno distinte: uno sportello può avere un
 * accettatore collegato e nessuna pratica in corso (è libero, aspetta il prossimo cliente) oppure
 * una pratica in corso e nessun collegato (chi l'aveva presa è uscito, la sessione è scaduta).
 */
export interface BayAssistanceView {
  readonly bayId: string;
  /** Lettera dello sportello (A, B, C, D). */
  readonly code: string;
  readonly name: string;
  /** Area per marchio a cui appartiene (FCA/PSA): serve al monitoraggio dell'amministratore. */
  readonly deskId: string | null;
  readonly deskCode: string | null;
  /** Postazione corrispondente, se configurata. */
  readonly workstationId: string | null;
  /** Operatore collegato a quella postazione adesso; null se non c'è nessuno. */
  readonly assignedOperatorName: string | null;
  /** Da quando è collegato. */
  readonly assignedSince: IsoDateTime | null;
  /** Pratica in lavorazione sullo sportello; null se è libero. */
  readonly occupiedBy: StuckAppointmentView | null;
}

export interface AssistanceView {
  readonly businessDate: IsoDate;
  readonly serverTime: IsoDateTime;
  readonly bays: readonly BayAssistanceView[];
  /** Tutte le pratiche in carico, anche senza accettazione assegnata, dalla più vecchia. */
  readonly inProgress: readonly StuckAppointmentView[];
}

export class AssistanceService {
  constructor(private readonly deps: AssistanceServiceDeps) {}

  async overview(businessDate: IsoDate): Promise<AssistanceView> {
    const now = this.deps.clock.now();
    const adesso = this.deps.clock.nowIso();
    const [inCarico, bays, desks, workstations, claims] = await Promise.all([
      this.deps.appointments.listByDate(businessDate, { statuses: ['IN_PROGRESS'] }),
      this.deps.referenceData.listBays(),
      this.deps.referenceData.listDesks(),
      this.deps.referenceData.listWorkstations(),
      this.deps.claims.listActive(adesso),
    ]);

    const viste = await Promise.all(inCarico.map(async (a) => this.toView(a, now, desks, bays)));
    viste.sort((x, y) => y.minutesInProgress - x.minutesInProgress);

    return {
      businessDate,
      serverTime: adesso,
      bays: bays
        .filter((b) => b.isActive)
        .map((b) => {
          // La postazione di uno sportello è quella che lo ha come campata predefinita: è la
          // corrispondenza fisica fra il banco e il PC che ci sta sopra.
          const postazione = workstations.find((w) => w.defaultBayId === b.id) ?? null;
          const claim =
            postazione === null ? undefined : claims.find((c) => c.workstationId === postazione.id);
          const desk =
            postazione === null ? null : (desks.find((d) => d.id === postazione.deskId) ?? null);
          return {
            bayId: b.id,
            code: b.code,
            name: b.name,
            deskId: desk?.id ?? null,
            deskCode: desk?.code ?? null,
            workstationId: postazione?.id ?? null,
            assignedOperatorName: claim?.operatorName ?? null,
            assignedSince: claim?.claimedAt ?? null,
            occupiedBy: viste.find((v) => v.bayCode === b.code) ?? null,
          };
        }),
      inProgress: viste,
    };
  }

  private async toView(
    a: Appointment,
    now: Date,
    desks: readonly { id: string; code: string }[],
    bays: readonly { id: string; code: string }[],
  ): Promise<StuckAppointmentView> {
    const operatore =
      a.operatorId === null ? null : await this.deps.operators.findById(a.operatorId);
    const daMs = a.takenAt === null ? 0 : now.getTime() - new Date(a.takenAt).getTime();
    return {
      id: a.id,
      code: a.code,
      plate: a.vehicle.plate,
      customerName: customerFullName(a.customer),
      version: a.version,
      operatorName: operatore?.displayName ?? null,
      deskCode: desks.find((d) => d.id === a.deskId)?.code ?? null,
      bayCode: bays.find((b) => b.id === a.bayId)?.code ?? null,
      since: a.takenAt,
      minutesInProgress: Math.max(0, Math.floor(daMs / 60_000)),
    };
  }
}
