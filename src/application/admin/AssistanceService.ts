// Strumenti di assistenza dell'amministratore: cosa è rimasto incagliato e come sbloccarlo.
//
// In questo sistema non esiste uno "sportello bloccato" come stato salvato: un'accettazione è
// occupata perché una pratica è IN_PROGRESS su di essa. Quindi sbloccare un'accettazione e
// liberare una pratica incagliata sono la stessa operazione vista da due lati: si rimette la
// pratica in coda (release) oppure, se il cliente non c'è più, la si annulla. Questa vista mette
// insieme i due lati con i dati che servono a decidere: chi l'aveva presa in carico e da quanto.
import type { Appointment } from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import type { WorkstationId } from '@/domain/ids';
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
  /**
   * Id dello stesso operatore. Serve alla vista "Persone e postazioni" per unire l'anagrafica e
   * il monitoraggio senza appaiare per nome: due colleghi omonimi non sono un'ipotesi da escludere
   * in una concessionaria, e un accoppiamento sbagliato mostrerebbe la pratica di uno sull'altro.
   */
  readonly assignedOperatorId: string | null;
  /** Da quando è collegato. */
  readonly assignedSince: IsoDateTime | null;
  /** Pratica in lavorazione sullo sportello; null se è libero. */
  readonly occupiedBy: StuckAppointmentView | null;
}

/**
 * Il polso della fila in questo momento: quante auto aspettano fuori e da quanto. Sono numeri
 * volutamente diversi da quelli del report di fine giornata — lì si guarda com'è andata, qui si
 * guarda cosa sta succedendo adesso, per decidere se aprire un altro sportello.
 */
export interface LiveQueueView {
  /** Auto in fila adesso: pratiche in attesa o saltate, ancora da servire. */
  readonly inQueue: number;
  /** Di quelle, quante hanno dichiarato di essere arrivate («sono arrivato» dal telefono). */
  readonly announced: number;
  /** Pratiche in lavorazione agli sportelli in questo momento. */
  readonly inProgress: number;
  /**
   * Attesa media di chi è in fila ADESSO, contata da quando ha dichiarato l'arrivo. Null se
   * nessuno si è ancora annunciato: meglio un trattino che una media inventata sull'orario di
   * prenotazione, che direbbe un'altra cosa.
   */
  readonly averageWaitMinutes: number | null;
  /** Attesa più lunga fra chi è in fila adesso, con la stessa regola. */
  readonly longestWaitMinutes: number | null;
  /**
   * Chi è quel cliente. Un numero solo dice che qualcuno aspetta da mezz'ora ma non chi andare a
   * cercare: con codice e nome l'amministratore può alzarsi e andare, invece di aprire la coda e
   * ricostruirlo da sé.
   */
  readonly longestWaitCode: string | null;
  readonly longestWaitCustomer: string | null;
}

export interface AssistanceView {
  readonly businessDate: IsoDate;
  readonly serverTime: IsoDateTime;
  readonly bays: readonly BayAssistanceView[];
  /** Tutte le pratiche in carico, anche senza accettazione assegnata, dalla più vecchia. */
  readonly inProgress: readonly StuckAppointmentView[];
  readonly live: LiveQueueView;
}

/** Esito dello sgancio di una postazione. */
export interface EjectResult {
  readonly workstationId: string;
  /** Chi era collegato; null se la postazione era già libera (lo sgancio è idempotente). */
  readonly operatorName: string | null;
  /** Codice della pratica rimasta in lavorazione su quello sportello, se c'è. */
  readonly stillInProgressCode: string | null;
}

export class AssistanceService {
  constructor(private readonly deps: AssistanceServiceDeps) {}

  /**
   * "Scollega": libera la postazione occupata da un operatore che ha finito il turno senza uscire.
   * Toglie solo l'occupazione del posto — la pratica eventualmente in carico su quello sportello
   * NON viene toccata, perché un veicolo accettato a metà non si chiude per un problema di
   * sessioni: resta in carico e si sblocca, se serve, con "Rimetti in coda" qui accanto.
   *
   * Effetto sull'operatore: la sua sessione smette di valere al primo clic (la verifica controlla
   * che il posto sia ancora suo), quindi si ritrova al login e può rientrare su uno sportello
   * libero. Idempotente: sganciare una postazione già libera non è un errore.
   */
  async eject(workstationId: WorkstationId): Promise<EjectResult> {
    const claim = await this.deps.claims.findByWorkstation(workstationId);
    if (claim !== null) {
      await this.deps.claims.deleteByWorkstation(workstationId);
    }
    const postazione = await this.deps.referenceData.findWorkstationById(workstationId);
    const inCarico =
      postazione === null
        ? []
        : await this.deps.appointments.listByDate(this.deps.clock.today(), {
            statuses: ['IN_PROGRESS'],
          });
    const pratica =
      postazione === null
        ? null
        : (inCarico.find((a) => a.bayId === postazione.defaultBayId) ?? null);
    return {
      workstationId,
      operatorName: claim?.operatorName ?? null,
      stillInProgressCode: pratica?.code ?? null,
    };
  }

  async overview(businessDate: IsoDate): Promise<AssistanceView> {
    const now = this.deps.clock.now();
    const adesso = this.deps.clock.nowIso();
    const [inCarico, inFila, bays, desks, workstations, claims] = await Promise.all([
      this.deps.appointments.listByDate(businessDate, { statuses: ['IN_PROGRESS'] }),
      this.deps.appointments.listByDate(businessDate, { statuses: ['WAITING', 'SKIPPED'] }),
      this.deps.referenceData.listBays(),
      this.deps.referenceData.listDesks(),
      this.deps.referenceData.listWorkstations(),
      this.deps.claims.listActive(adesso),
    ]);

    // Attese di chi è in fila adesso, da quando ha dichiarato l'arrivo: è l'unico istante che
    // sappiamo per certo, perché l'orario di prenotazione dice quando era atteso, non da quando
    // sta aspettando davvero.
    const annunciate = inFila
      .filter((a) => a.customerArrivedAt !== null)
      .map((a) => ({
        pratica: a,
        minuti: Math.max(
          0,
          Math.floor((now.getTime() - new Date(a.customerArrivedAt!).getTime()) / 60_000),
        ),
      }));
    const attese = annunciate.map((x) => x.minuti);
    // Chi aspetta da più tempo, non solo da quanto: serve il nome per poterlo andare a chiamare.
    const piuInAttesa = annunciate.reduce<(typeof annunciate)[number] | null>(
      (peggiore, x) => (peggiore === null || x.minuti > peggiore.minuti ? x : peggiore),
      null,
    );
    const live: LiveQueueView = {
      inQueue: inFila.length,
      announced: attese.length,
      inProgress: inCarico.length,
      averageWaitMinutes:
        attese.length === 0
          ? null
          : Math.round(attese.reduce((somma, m) => somma + m, 0) / attese.length),
      longestWaitMinutes: piuInAttesa?.minuti ?? null,
      longestWaitCode: piuInAttesa?.pratica.code ?? null,
      longestWaitCustomer:
        piuInAttesa === null ? null : customerFullName(piuInAttesa.pratica.customer),
    };

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
            assignedOperatorId: claim?.operatorId ?? null,
            assignedSince: claim?.claimedAt ?? null,
            occupiedBy: viste.find((v) => v.bayCode === b.code) ?? null,
          };
        }),
      inProgress: viste,
      live,
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
