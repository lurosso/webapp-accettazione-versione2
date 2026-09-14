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
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';

export interface AssistanceServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
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

export interface BayAssistanceView {
  readonly bayId: string;
  readonly code: string;
  readonly name: string;
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
    const [inCarico, bays, desks] = await Promise.all([
      this.deps.appointments.listByDate(businessDate, { statuses: ['IN_PROGRESS'] }),
      this.deps.referenceData.listBays(),
      this.deps.referenceData.listDesks(),
    ]);

    const viste = await Promise.all(inCarico.map(async (a) => this.toView(a, now, desks, bays)));
    viste.sort((x, y) => y.minutesInProgress - x.minutesInProgress);

    return {
      businessDate,
      serverTime: this.deps.clock.nowIso(),
      bays: bays
        .filter((b) => b.isActive)
        .map((b) => ({
          bayId: b.id,
          code: b.code,
          name: b.name,
          occupiedBy: viste.find((v) => v.bayCode === b.code) ?? null,
        })),
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
