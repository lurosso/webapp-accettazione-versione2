// Assegnazione dei codici progressivi F001, F002… (ARCHITECTURE.md §5.3).
// Il contatore vive nel repository (atomico nel processo) ed è condiviso da sync e inserimenti
// manuali; il codice è identità immutabile, mai rinumerato né riutilizzato.
import type { Brand } from '@/domain/entities/brand';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { formatQueueCode, type QueueCode } from '@/domain/value-objects/queue-code';
import type { IAppointmentRepository } from '@/repositories/interfaces';

/** Ambito del contatore: unico per la sede (default) oppure uno per marchio con il suo prefisso. */
export type CodeSequenceScope = 'SITE' | 'BRAND';

export interface CodeGeneratorOptions {
  /** Prefisso usato con `scope = 'SITE'` (env CODE_PREFIX, default "F"). */
  readonly sitePrefix: string;
  readonly scope: CodeSequenceScope;
}

export interface AssignedCode {
  readonly code: QueueCode;
  readonly sequence: number;
  readonly prefix: string;
}

export class CodeGenerator {
  constructor(
    private readonly appointments: IAppointmentRepository,
    private readonly options: CodeGeneratorOptions,
  ) {}

  /** Prefisso effettivo per la pratica: dipende dall'ambito configurato. */
  prefixFor(brand: Brand): string {
    return this.options.scope === 'BRAND' ? brand.codePrefix : this.options.sitePrefix;
  }

  /** Riserva il prossimo numero della giornata e lo formatta (F001…, F1000 oltre 999). */
  async next(businessDate: IsoDate, brand: Brand): Promise<AssignedCode> {
    const prefix = this.prefixFor(brand);
    const sequence = await this.appointments.reserveNextSequence(businessDate, prefix);
    return { code: formatQueueCode(prefix, sequence), sequence, prefix };
  }
}
