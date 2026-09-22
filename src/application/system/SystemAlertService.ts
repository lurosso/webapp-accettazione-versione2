// Segnalazioni di disfunzione: dal personale all'amministratore.
//
// Chi sta al banco vede un controllo rosso nella pagina Sistema — o una stampante che non stampa,
// che nessun controllo vede — e con un tocco lo dice a chi può intervenire. La segnalazione porta
// il codice del controllo, il componente, il messaggio, chi l'ha fatta e da quale postazione, e
// l'amministratore la porta da nuova a in gestione a risolta. Ogni cambiamento pubblica un evento:
// il cruscotto dell'amministratore si aggiorna da solo, senza che nessuno ricarichi la pagina.
import {
  canTransitionAlert,
  isSystemAlertComponent,
  SYSTEM_ALERT_COMPONENT_LABELS,
  SYSTEM_ALERT_STATUS_LABELS,
  type SystemAlert,
  type SystemAlertComponent,
  type SystemAlertStatus,
} from '@/domain/entities/system-alert';
import { domainError, type DomainError } from '@/domain/errors';
import {
  asSystemAlertId,
  type OperatorId,
  type SystemAlertId,
  type WorkstationId,
} from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import type { IReferenceDataRepository } from '@/repositories/interfaces';
import type { ISystemAlertRepository } from '@/repositories/interfaces/ISystemAlertRepository';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';

export interface SystemAlertServiceDeps {
  readonly alerts: ISystemAlertRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

/** Chi fa o gestisce la segnalazione: dalla sessione, mai dal corpo della richiesta. */
export interface AlertActor {
  readonly operatorId: OperatorId;
  readonly displayName: string;
  readonly workstationId: WorkstationId | null;
}

export interface CreateAlertInput {
  readonly code: string;
  readonly component: string;
  readonly message: string;
}

export interface AlertSummary {
  readonly new: number;
  readonly inProgress: number;
  readonly resolved: number;
}

/** Quante segnalazioni al massimo si restituiscono in elenco. */
export const MAX_ALERTS_LISTED = 200;

const CODICE = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
const MAX_MESSAGE = 500;
const MAX_NOTE = 500;

export class SystemAlertService {
  private readonly logger: ILogger;

  constructor(private readonly deps: SystemAlertServiceDeps) {
    this.logger = deps.logger.child('[Segnalazioni]');
  }

  /**
   * Nuova segnalazione. Il codice si normalizza in maiuscolo; componente e messaggio devono
   * essere sensati (niente segnalazioni vuote che l'amministratore non saprebbe leggere).
   */
  async create(
    input: CreateAlertInput,
    actor: AlertActor,
    correlationId: string,
  ): Promise<Result<SystemAlert, DomainError>> {
    const code = input.code.trim().toUpperCase();
    if (!CODICE.test(code)) {
      return err(
        domainError('VALIDATION', 'Codice della segnalazione non valido (lettere, cifre, - e _).', {
          code: input.code,
        }),
      );
    }
    if (!isSystemAlertComponent(input.component)) {
      return err(
        domainError('VALIDATION', 'Componente della segnalazione non riconosciuto.', {
          component: input.component,
        }),
      );
    }
    const component: SystemAlertComponent = input.component;
    const message = input.message.trim();
    if (message === '' || message.length > MAX_MESSAGE) {
      return err(
        domainError('VALIDATION', `Il messaggio va da 1 a ${MAX_MESSAGE} caratteri.`, {
          length: message.length,
        }),
      );
    }
    const workstation =
      actor.workstationId === null
        ? null
        : await this.deps.referenceData.findWorkstationById(actor.workstationId);
    const now = this.deps.clock.nowIso();
    const alert = await this.deps.alerts.insert({
      id: this.deps.ids.nextAs(asSystemAlertId),
      code,
      component,
      message,
      status: 'NEW',
      reportedByOperatorId: actor.operatorId,
      reportedByName: actor.displayName,
      workstationId: actor.workstationId,
      workstationName: workstation?.name ?? null,
      createdAt: now,
      updatedAt: now,
      handledByOperatorId: null,
      handledByName: null,
      resolvedAt: null,
      adminNote: null,
    });
    this.publish(alert, actor, correlationId);
    this.logger.warn(`segnalazione ${alert.code} su ${SYSTEM_ALERT_COMPONENT_LABELS[component]}`, {
      alertId: alert.id,
      operatorId: actor.operatorId,
      workstation: alert.workstationName,
      message,
    });
    return ok(alert);
  }

  /** Le segnalazioni, dalla più recente; risolte incluse solo se richiesto. */
  list(includeResolved: boolean, limit = MAX_ALERTS_LISTED): Promise<readonly SystemAlert[]> {
    return this.deps.alerts.list({
      ...(includeResolved ? {} : { statuses: ['NEW', 'IN_PROGRESS'] as const }),
      limit: Math.min(Math.max(1, limit), MAX_ALERTS_LISTED),
    });
  }

  async summary(): Promise<AlertSummary> {
    const c = await this.deps.alerts.countByStatus();
    return { new: c.NEW, inProgress: c.IN_PROGRESS, resolved: c.RESOLVED };
  }

  /** Cambio di stato da parte dell'amministratore, con una nota facoltativa. */
  async updateStatus(
    id: SystemAlertId,
    status: SystemAlertStatus,
    actor: AlertActor,
    correlationId: string,
    note: string | null = null,
  ): Promise<Result<SystemAlert, DomainError>> {
    const corrente = await this.deps.alerts.findById(id);
    if (corrente === null) {
      return err(domainError('NOT_FOUND', 'Segnalazione non trovata.', { id }));
    }
    if (!canTransitionAlert(corrente.status, status)) {
      return err(
        domainError(
          'INVALID_TRANSITION',
          `Una segnalazione «${SYSTEM_ALERT_STATUS_LABELS[corrente.status]}» non può passare a «${SYSTEM_ALERT_STATUS_LABELS[status]}».`,
          { from: corrente.status, to: status },
        ),
      );
    }
    const nota = note === null ? null : note.trim().slice(0, MAX_NOTE);
    const now = this.deps.clock.nowIso();
    const aggiornata = await this.deps.alerts.update({
      ...corrente,
      status,
      updatedAt: now,
      handledByOperatorId: actor.operatorId,
      handledByName: actor.displayName,
      resolvedAt: status === 'RESOLVED' ? now : null,
      adminNote: nota === '' ? corrente.adminNote : (nota ?? corrente.adminNote),
    });
    this.publish(aggiornata, actor, correlationId);
    this.logger.info(`segnalazione ${aggiornata.code}: ${SYSTEM_ALERT_STATUS_LABELS[status]}`, {
      alertId: aggiornata.id,
      operatorId: actor.operatorId,
    });
    return ok(aggiornata);
  }

  private publish(alert: SystemAlert, actor: AlertActor, correlationId: string): void {
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: this.deps.clock.nowIso(),
      correlationId,
      actor: { kind: 'OPERATOR', id: actor.operatorId },
      type: 'SYSTEM_ALERT_CHANGED',
      alertId: alert.id,
      status: alert.status,
      component: alert.component,
    });
  }
}
