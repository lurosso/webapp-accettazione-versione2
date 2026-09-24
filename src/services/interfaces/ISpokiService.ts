// Porta verso Spoki (WhatsApp Business): invio template e tracciamento consegna.

import type { Result } from '@/domain/result';
import type {
  SpokiContactUpdateDto,
  SpokiContactUpdateReceipt,
  SpokiSendRequestDto,
} from '../dto/spoki.dto';
import type { SpokiWebhookEvent } from '../dto/spoki-webhook.dto';
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
  /**
   * Aggiorna i campi personalizzati del contatto senza mandare messaggi. Stessi blocchi dell'invio
   * (simulazione, blocco di sicurezza, demo interna): bloccato = `updated: false`, non un errore.
   */
  updateContactFields(
    request: SpokiContactUpdateDto,
    options?: CallOptions,
  ): Promise<ProviderResult<SpokiContactUpdateReceipt>>;
  /** Stato di consegna di un messaggio già accettato. */
  getDeliveryStatus(
    providerMessageId: string,
    options?: CallOptions,
  ): Promise<ProviderResult<DeliveryStatus>>;
  /**
   * Interpreta un webhook di Spoki (esito di consegna, messaggio in entrata o altro evento) nella
   * forma normalizzata. Sincrono, senza I/O; la firma la verifica la rotta.
   */
  parseWebhook(
    rawBody: unknown,
    headers: Readonly<Record<string, string>>,
  ): Result<SpokiWebhookEvent, ProviderError>;
  /** Stato di salute del provider. */
  healthCheck(options?: CallOptions): Promise<HealthStatus>;
}
