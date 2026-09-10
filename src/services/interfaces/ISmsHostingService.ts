// Porta verso SMS Hosting: canale SMS di fallback quando WhatsApp fallisce.

import type { SmsSendRequestDto } from '../dto/sms-hosting.dto';
import type {
  CallOptions,
  DeliveryStatus,
  HealthStatus,
  ProviderResult,
  SendReceipt,
} from './common';

/** Canale SMS. */
export interface ISmsHostingService {
  readonly name: 'SMS_HOSTING';
  /** Invia un SMS; idempotente per `request.idempotencyKey`. */
  sendSms(request: SmsSendRequestDto, options?: CallOptions): Promise<ProviderResult<SendReceipt>>;
  /** Stato di consegna di un SMS già accettato. */
  getDeliveryStatus(
    providerMessageId: string,
    options?: CallOptions,
  ): Promise<ProviderResult<DeliveryStatus>>;
  /** Credito residuo in numero di SMS. */
  getCredits(options?: CallOptions): Promise<ProviderResult<{ readonly remaining: number }>>;
  /** Stato di salute del provider. */
  healthCheck(options?: CallOptions): Promise<HealthStatus>;
}
