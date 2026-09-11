// Outbox degli eventi verso il CRM (modulo F).

import type { CrmOutboxEvent, CrmOutboxStatus } from '@/domain/entities/crm-outbox-event';
import type { CrmOutboxEventId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';

/** Repository dell'outbox CRM. */
export interface ICrmOutboxRepository {
  insert(event: CrmOutboxEvent): Promise<CrmOutboxEvent>;
  update(event: CrmOutboxEvent): Promise<CrmOutboxEvent>;
  findById(id: CrmOutboxEventId): Promise<CrmOutboxEvent | null>;
  findByIdempotencyKey(key: string): Promise<CrmOutboxEvent | null>;
  /**
   * Eventi PENDING/FAILED con un `nextAttemptAt` già scaduto, i più vecchi per primi.
   * `nextAttemptAt === null` significa "non riprovare più" (consegna abbandonata dopo i tentativi
   * previsti, oppure lead chiuso a mano dal BDC): quelle righe restano fuori, altrimenti un CRM
   * irrimediabilmente giù terrebbe il temporizzatore a riprovare in eterno.
   */
  listDue(now: IsoDateTime, limit: number): Promise<readonly CrmOutboxEvent[]>;
  listByStatus(statuses: readonly CrmOutboxStatus[]): Promise<readonly CrmOutboxEvent[]>;
}
