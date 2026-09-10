// Repository delle pratiche su Map: copie immutabili in uscita, versioning ottimistico,
// contatore codici atomico nel singolo processo.

import type { Appointment } from '@/domain/entities/appointment';
import { ACTIVE_QUEUE_STATUSES } from '@/domain/entities/appointment';
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { AppointmentId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { PlateNumber } from '@/domain/value-objects/plate';
import type { QueueCode } from '@/domain/value-objects/queue-code';
import { compareByScheduleThenSequence } from '@/domain/value-objects/queue-code';
import type { IClock } from '@/services/interfaces/IClock';
import type {
  AheadScope,
  AppointmentFilter,
  IAppointmentRepository,
} from '../interfaces/IAppointmentRepository';
import type { InMemoryStore } from './InMemoryStore';

/** Copia difensiva della pratica (snapshot cliente/veicolo inclusi). */
function clone(a: Appointment): Appointment {
  return { ...a, customer: { ...a.customer }, vehicle: { ...a.vehicle } };
}

/** Repository in memoria delle pratiche. */
export class InMemoryAppointmentRepository implements IAppointmentRepository {
  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: IClock,
  ) {}

  private get map(): Map<string, Appointment> {
    return this.store.state.appointments;
  }

  async findById(id: AppointmentId): Promise<Appointment | null> {
    const found = this.map.get(id);
    return found === undefined ? null : clone(found);
  }

  async findByExternalRef(externalRef: string, businessDate: IsoDate): Promise<Appointment | null> {
    for (const a of this.map.values()) {
      if (a.externalRef === externalRef && a.businessDate === businessDate) {
        return clone(a);
      }
    }
    return null;
  }

  async findByCode(code: QueueCode, businessDate: IsoDate): Promise<Appointment | null> {
    for (const a of this.map.values()) {
      if (a.code === code && a.businessDate === businessDate) {
        return clone(a);
      }
    }
    return null;
  }

  async findByPlate(plate: PlateNumber, businessDate: IsoDate): Promise<readonly Appointment[]> {
    const out: Appointment[] = [];
    for (const a of this.map.values()) {
      if (a.vehicle.plate === plate && a.businessDate === businessDate) {
        out.push(clone(a));
      }
    }
    return out.sort(compareByScheduleThenSequence);
  }

  async listByDate(businessDate: IsoDate, filter?: AppointmentFilter): Promise<readonly Appointment[]> {
    // `statuses` è autoritativo: chi chiede esplicitamente CANCELLED le ottiene anche senza includeCancelled.
    const includeCancelled =
      filter?.includeCancelled ?? filter?.statuses?.includes('CANCELLED') ?? false;
    const out: Appointment[] = [];
    for (const a of this.map.values()) {
      if (a.businessDate !== businessDate) {
        continue;
      }
      if (a.status === 'CANCELLED' && !includeCancelled) {
        continue;
      }
      if (filter?.brandIds !== undefined && !filter.brandIds.includes(a.brandId)) {
        continue;
      }
      if (
        filter?.deskIds !== undefined &&
        (a.deskId === null || !filter.deskIds.includes(a.deskId))
      ) {
        continue;
      }
      if (filter?.statuses !== undefined && !filter.statuses.includes(a.status)) {
        continue;
      }
      out.push(clone(a));
    }
    return out.sort(compareByScheduleThenSequence);
  }

  async insert(appointment: Appointment): Promise<Result<Appointment, DomainError>> {
    // Nessuna sovrascrittura silenziosa: id, codice e riferimento esterno sono univoci per giornata.
    if (this.map.has(appointment.id)) {
      return err(
        domainError('VALIDATION', `Pratica già presente: ${appointment.id}.`, {
          appointmentId: appointment.id,
        }),
      );
    }
    for (const other of this.map.values()) {
      if (other.businessDate !== appointment.businessDate) {
        continue;
      }
      if (other.code === appointment.code) {
        return err(
          domainError('VALIDATION', `Codice ${appointment.code} già assegnato nella giornata.`, {
            code: appointment.code,
            existingAppointmentId: other.id,
          }),
        );
      }
      if (appointment.externalRef !== null && other.externalRef === appointment.externalRef) {
        return err(
          domainError(
            'VALIDATION',
            `Riferimento Infinity ${appointment.externalRef} già presente nella giornata.`,
            { externalRef: appointment.externalRef, existingAppointmentId: other.id },
          ),
        );
      }
    }
    const stored = clone(appointment);
    this.map.set(stored.id, stored);
    return ok(clone(stored));
  }

  async update(
    appointment: Appointment,
    expectedVersion: number,
  ): Promise<Result<Appointment, DomainError>> {
    const current = this.map.get(appointment.id);
    if (current === undefined) {
      return err(domainError('NOT_FOUND', `Pratica non trovata: ${appointment.id}.`));
    }
    if (current.version !== expectedVersion) {
      return err(
        domainError(
          'VERSION_CONFLICT',
          "La pratica è stata modificata da un'altra postazione. Ricarica e riprova.",
          {
            appointmentId: appointment.id,
            expectedVersion,
            currentVersion: current.version,
            current: clone(current),
          },
        ),
      );
    }
    const next: Appointment = {
      ...clone(appointment),
      version: current.version + 1,
      updatedAt: this.clock.nowIso(),
    };
    this.map.set(next.id, next);
    return ok(clone(next));
  }

  async reserveNextSequence(businessDate: IsoDate, prefix: string): Promise<number> {
    // Lettura e incremento sincroni: atomici nel singolo processo Node (vincolo documentato).
    const key = `${businessDate}|${prefix}`;
    const next = (this.store.state.sequences.get(key) ?? 0) + 1;
    this.store.state.sequences.set(key, next);
    return next;
  }

  async countAhead(appointment: Appointment, scope: AheadScope): Promise<number> {
    let count = 0;
    for (const other of this.map.values()) {
      if (other.id === appointment.id || other.businessDate !== appointment.businessDate) {
        continue;
      }
      if (!ACTIVE_QUEUE_STATUSES.includes(other.status)) {
        continue;
      }
      if (scope === 'DESK' && other.deskId !== appointment.deskId) {
        continue;
      }
      if (compareByScheduleThenSequence(other, appointment) < 0) {
        count += 1;
      }
    }
    return count;
  }

  async clear(businessDate?: IsoDate): Promise<void> {
    if (businessDate === undefined) {
      this.map.clear();
      this.store.state.sequences.clear();
      return;
    }
    for (const [id, a] of this.map.entries()) {
      if (a.businessDate === businessDate) {
        this.map.delete(id);
      }
    }
    for (const key of this.store.state.sequences.keys()) {
      if (key.startsWith(`${businessDate}|`)) {
        this.store.state.sequences.delete(key);
      }
    }
  }
}
