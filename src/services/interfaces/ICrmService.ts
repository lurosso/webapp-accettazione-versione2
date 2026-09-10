// Porta verso il CRM aziendale / BDC (modulo F): webhook per no-show e anomalie.

import type { CrmAckDto, CrmAnomalyPayloadDto, CrmNoShowPayloadDto } from '../dto/crm.dto';
import type { CallOptions, HealthStatus, ProviderResult } from './common';

/** Notifiche verso il CRM per le attività di ricontatto del BDC. */
export interface ICrmService {
  readonly name: 'CRM';
  /** Segnala un appuntamento non rispettato. */
  notifyNoShow(
    payload: CrmNoShowPayloadDto,
    options?: CallOptions,
  ): Promise<ProviderResult<CrmAckDto>>;
  /** Segnala un'anomalia di flusso. */
  notifyAnomaly(
    payload: CrmAnomalyPayloadDto,
    options?: CallOptions,
  ): Promise<ProviderResult<CrmAckDto>>;
  /** Stato di salute del CRM. */
  healthCheck(options?: CallOptions): Promise<HealthStatus>;
}
