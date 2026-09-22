// Webhook in entrata da Spoki, nella forma "wire" e nella forma normalizzata che il resto
// dell'applicazione capisce. Un solo parser, condiviso dal servizio reale e dal mock, così la
// rotta e i test ragionano su un'unica struttura qualunque sia il provider cablato.
//
// Formato ufficiale (webhook V2, https://api.spoki.com/api/1/external-webhooks/):
//   { version: 2, event: "message.outbound" | "message.inbound" | …, event_uuid, timestamp,
//     data: { uuid, send_status, sent_datetime, delivered_datetime, from_phone, to_phone, text,
//             send_error_message, error_code, metadata, payload, … } }
// firmato con `X-Spoki-Signature: t=<unix>,v2=<hmac-sha256>` (verifica nella rotta, non qui).
// Si accetta anche la forma piatta `{ messageId | message_id | id | uuid, status, reason? }`,
// utile alle prove manuali e alle automazioni che rimandano un webhook semplice.
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { DeliveryStatus, ProviderError } from '../interfaces/common';
import { providerError } from '../interfaces/common';

/** Evento di webhook normalizzato. */
export type SpokiWebhookEvent =
  | {
      /** Esito di un messaggio in uscita: inviato, consegnato, letto, fallito. */
      readonly kind: 'DELIVERY';
      readonly providerMessageId: string;
      readonly state: DeliveryStatus['state'];
      /** Quando è successo secondo Spoki; null se non lo dice. */
      readonly occurredAt: IsoDateTime | null;
      readonly reason: string | null;
      /** Numero del destinatario (E.164) se presente: serve a ritrovare il messaggio senza id. */
      readonly recipient: string | null;
      /** Metadati che avevamo allegato all'invio, se Spoki li rimanda. */
      readonly metadata: Readonly<Record<string, unknown>> | null;
      /** Identificativo dell'evento (idempotenza dei ritenti del provider). */
      readonly eventId: string | null;
    }
  | {
      /** Messaggio del cliente in entrata (testo o pulsante). */
      readonly kind: 'INBOUND';
      readonly from: string | null;
      readonly text: string | null;
      /** Payload del pulsante rapido, se il cliente ne ha toccato uno. */
      readonly payload: string | null;
      readonly occurredAt: IsoDateTime | null;
      readonly eventId: string | null;
    }
  | {
      /** Evento che non riguarda l'officina (contatti, template, canali…). */
      readonly kind: 'IGNORED';
      readonly event: string;
      readonly eventId: string | null;
    };

/** Stati di Spoki (`send_status`) e sinonimi → stato della porta. Confronto senza maiuscole. */
const STATE_BY_STATUS: Readonly<Record<string, DeliveryStatus['state']>> = {
  queued: 'QUEUED',
  pending: 'QUEUED',
  accepted: 'QUEUED',
  scheduled: 'QUEUED',
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  seen: 'READ',
  failed: 'FAILED',
  error: 'FAILED',
  rejected: 'FAILED',
  undeliverable: 'UNDELIVERABLE',
  undelivered: 'UNDELIVERABLE',
  'not delivered': 'UNDELIVERABLE',
};

function stringa(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v);
  }
  return null;
}

function oggetto(v: unknown): Readonly<Record<string, unknown>> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Stato normalizzato, o null se la parola non è fra quelle note. */
export function deliveryStateFromStatus(status: string): DeliveryStatus['state'] | null {
  return STATE_BY_STATUS[status.trim().toLowerCase()] ?? null;
}

/** Data ISO da un ISO con fuso, da un epoch in secondi o millisecondi; null se illeggibile. */
function istante(v: unknown): IsoDateTime | null {
  if (typeof v === 'string' && v.trim() !== '') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : (d.toISOString() as IsoDateTime);
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : (d.toISOString() as IsoDateTime);
  }
  return null;
}

function invalido(message: string): Result<never, ProviderError> {
  return err(providerError('SPOKI', 'INVALID_REQUEST', `Webhook Spoki: ${message}`, false));
}

/**
 * Interpreta il corpo di un webhook Spoki. Non verifica firma né segreto (compito della rotta) e
 * non fa I/O. Un corpo che non è né un evento V2 né la forma piatta è un errore INVALID_REQUEST.
 */
export function parseSpokiWebhookBody(rawBody: unknown): Result<SpokiWebhookEvent, ProviderError> {
  const body = oggetto(rawBody);
  if (body === null) {
    return invalido('corpo non valido.');
  }
  const event = stringa(body['event']);
  const eventId = stringa(body['event_uuid'] ?? body['eventId'] ?? body['event_id']);

  // Busta V2: `event` + `data`.
  if (event !== null && oggetto(body['data']) !== null) {
    const data = oggetto(body['data']) ?? {};
    if (event === 'message.outbound') {
      const providerMessageId = stringa(
        data['uuid'] ?? data['id'] ?? data['message_id'] ?? data['messageId'],
      );
      const status = stringa(data['send_status'] ?? data['status']);
      if (providerMessageId === null) {
        return invalido('evento message.outbound senza identificativo del messaggio.');
      }
      if (status === null) {
        return invalido('evento message.outbound senza send_status.');
      }
      const state = deliveryStateFromStatus(status);
      if (state === null) {
        return invalido(`stato sconosciuto "${status}".`);
      }
      return ok({
        kind: 'DELIVERY',
        providerMessageId,
        state,
        occurredAt:
          istante(data['delivered_datetime']) ??
          istante(data['sent_datetime']) ??
          istante(data['timestamp']) ??
          istante(body['timestamp']),
        reason: stringa(data['send_error_message']) ?? stringa(data['error_code']),
        recipient: stringa(data['to_phone']),
        metadata: oggetto(data['metadata']),
        eventId,
      });
    }
    if (event === 'message.inbound') {
      return ok({
        kind: 'INBOUND',
        from: stringa(data['from_phone'] ?? data['phone']),
        text: stringa(data['text']),
        payload: stringa(data['payload']),
        occurredAt: istante(data['sent_datetime']) ?? istante(body['timestamp']),
        eventId,
      });
    }
    return ok({ kind: 'IGNORED', event, eventId });
  }

  // Forma piatta: { messageId | message_id | id | uuid, status, reason?, phone? }.
  const providerMessageId = stringa(
    body['messageId'] ?? body['message_id'] ?? body['id'] ?? body['uuid'],
  );
  const status = stringa(body['status'] ?? body['send_status']);
  if (providerMessageId === null || status === null) {
    return invalido('messageId o status mancanti.');
  }
  const state = deliveryStateFromStatus(status);
  if (state === null) {
    return invalido(`stato sconosciuto "${status}".`);
  }
  return ok({
    kind: 'DELIVERY',
    providerMessageId,
    state,
    occurredAt: istante(body['timestamp'] ?? body['at']),
    reason: stringa(body['reason']) ?? stringa(body['error']),
    recipient: stringa(body['to_phone'] ?? body['phone']),
    metadata: oggetto(body['metadata']),
    eventId,
  });
}

/** True se il corpo ha la forma di un webhook di esito o di evento V2 (e non di una risposta piatta del cliente). */
export function looksLikeSpokiEvent(rawBody: unknown): boolean {
  const body = oggetto(rawBody);
  if (body === null) {
    return false;
  }
  if (stringa(body['event']) !== null && oggetto(body['data']) !== null) {
    return true;
  }
  return (
    stringa(body['status'] ?? body['send_status']) !== null &&
    stringa(body['messageId'] ?? body['message_id'] ?? body['id'] ?? body['uuid']) !== null
  );
}
