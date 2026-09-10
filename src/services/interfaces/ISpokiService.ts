// Porta verso Spoki (WhatsApp Business): invio template e tracciamento consegna.

import type { Result } from '@/domain/result';
import type { SpokiSendRequestDto } from '../dto/spoki.dto';
import type {
  CallOptions,
  DeliveryStatus,
  HealthStatus,
  ProviderError,
  ProviderResult,
  SendReceipt,
} from './common';

/** Canale WhatsApp. */
export interface ISpokiService {
  readonly name: 'SPOKI';
  /** Invia un messaggio template; idempotente per `request.idempotencyKey`. */
  sendTemplateMessage(
    request: SpokiSendRequestDto,
    options?: CallOptions,
  ): Promise<ProviderResult<SendReceipt>>;
  /** Stato di consegna di un messaggio già accettato. */
  getDeliveryStatus(
    providerMessageId: string,
    options?: CallOptions,
  ): Promise<ProviderResult<DeliveryStatus>>;
  /** Interpreta il webhook di esito consegna (sincrono, senza I/O). */
  parseWebhook(
    rawBody: unknown,
    headers: Readonly<Record<string, string>>,
  ): Result<DeliveryStatus, ProviderError>;
  /** Stato di salute del provider. */
  healthCheck(options?: CallOptions): Promise<HealthStatus>;
}
