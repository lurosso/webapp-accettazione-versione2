// Il parser condiviso dei webhook Spoki: eventi V2 (esiti in uscita, messaggi in entrata, altro),
// forma piatta delle automazioni, sinonimi degli stati e corpi che non significano nulla.
import { describe, expect, it } from 'vitest';
import {
  deliveryStateFromStatus,
  looksLikeSpokiEvent,
  parseSpokiWebhookBody,
} from '@/services/dto/spoki-webhook.dto';

/** Evento `message.outbound` V2 come lo documenta Spoki (campi ridotti a quelli che contano). */
function outbound(overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    version: 2,
    event: 'message.outbound',
    event_uuid: '8992ce12-1474-4cbf-bc0b-c1dbf79b3a7e',
    timestamp: 1683893130.979,
    data: {
      uuid: '8992ce1214744cbfbc0bc1dbf79b3a7e',
      delivered_datetime: null,
      sent_datetime: null,
      direction: 'Outbound',
      type: 'Message',
      content_type: 'Text',
      from_phone: '+390831981810',
      to_phone: '+393331234567',
      text: 'a presto',
      send_status: 'Delivered',
      send_error_message: null,
      error_code: null,
      timestamp: 1683893130979,
      created_datetime: '2023-05-12T12:05:30.978568+00:00',
      metadata: null,
      ...data,
    },
    ...overrides,
  };
}

describe('Webhook Spoki V2: esiti dei messaggi in uscita', () => {
  it('message.outbound diventa un esito con id, stato, destinatario, istante ed event id', () => {
    const r = parseSpokiWebhookBody(outbound());
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.kind !== 'DELIVERY') {
      throw new Error('atteso DELIVERY');
    }
    expect(r.value.providerMessageId).toBe('8992ce1214744cbfbc0bc1dbf79b3a7e');
    expect(r.value.state).toBe('DELIVERED');
    expect(r.value.recipient).toBe('+393331234567');
    expect(r.value.eventId).toBe('8992ce12-1474-4cbf-bc0b-c1dbf79b3a7e');
    expect(r.value.reason).toBeNull();
    // Nessuna data di consegna né di invio: vale il timestamp dell'evento (secondi con decimali).
    expect(r.value.occurredAt).toBe('2023-05-12T12:05:30.979Z');
  });

  it('gli stati di Spoki si leggono senza maiuscole e con i sinonimi; quelli ignoti sono un errore', () => {
    expect(deliveryStateFromStatus('Sent')).toBe('SENT');
    expect(deliveryStateFromStatus('DELIVERED')).toBe('DELIVERED');
    expect(deliveryStateFromStatus('read')).toBe('READ');
    expect(deliveryStateFromStatus('seen')).toBe('READ');
    expect(deliveryStateFromStatus('Failed')).toBe('FAILED');
    expect(deliveryStateFromStatus('undelivered')).toBe('UNDELIVERABLE');
    expect(deliveryStateFromStatus('pending')).toBe('QUEUED');
    expect(deliveryStateFromStatus('---')).toBeNull();
    const ignoto = parseSpokiWebhookBody(outbound({}, { send_status: 'boh' }));
    expect(!ignoto.ok && ignoto.error.code).toBe('INVALID_REQUEST');
  });

  it('un esito fallito porta il motivo e la data di consegna prevale sul timestamp', () => {
    const r = parseSpokiWebhookBody(
      outbound(
        {},
        {
          send_status: 'Failed',
          send_error_message: 'Numero non su WhatsApp',
          error_code: '131026',
          delivered_datetime: '2023-05-12T14:05:30+02:00',
        },
      ),
    );
    expect(r.ok && r.value.kind === 'DELIVERY' && r.value.reason).toBe('Numero non su WhatsApp');
    expect(r.ok && r.value.kind === 'DELIVERY' && r.value.occurredAt).toBe(
      '2023-05-12T12:05:30.000Z',
    );
  });

  it('i metadati allegati all’invio tornano indietro così come sono', () => {
    const r = parseSpokiWebhookBody(
      outbound({}, { metadata: { idempotency_key: 'app-1:CHECK_IN_STARTED:2026-09-22:WA:1' } }),
    );
    expect(r.ok && r.value.kind === 'DELIVERY' && r.value.metadata).toEqual({
      idempotency_key: 'app-1:CHECK_IN_STARTED:2026-09-22:WA:1',
    });
  });

  it('senza id del messaggio o senza stato l’evento è rifiutato', () => {
    expect(parseSpokiWebhookBody(outbound({}, { uuid: undefined })).ok).toBe(false);
    expect(parseSpokiWebhookBody(outbound({}, { send_status: undefined })).ok).toBe(false);
  });
});

describe('Webhook Spoki V2: messaggi in entrata e altri eventi', () => {
  it('message.inbound porta mittente, testo e payload del pulsante', () => {
    const r = parseSpokiWebhookBody({
      version: 2,
      event: 'message.inbound',
      event_uuid: 'b78213e0-7556-4866-807d-bd1780eaa09d',
      timestamp: 1683889161.466,
      data: {
        uuid: 'b78213e075564866807dbd1780eaa09d',
        direction: 'Inbound',
        from_phone: '+393331234567',
        to_phone: '+390831981810',
        text: 'Arrivato',
        send_status: '---',
        sent_datetime: '2023-05-12T12:59:21+02:00',
        payload: 'ARRIVED',
      },
    });
    expect(r.ok && r.value).toMatchObject({
      kind: 'INBOUND',
      from: '+393331234567',
      text: 'Arrivato',
      payload: 'ARRIVED',
      occurredAt: '2023-05-12T10:59:21.000Z',
      eventId: 'b78213e0-7556-4866-807d-bd1780eaa09d',
    });
  });

  it('gli eventi che non riguardano l’officina sono riconosciuti e ignorati, non rifiutati', () => {
    const r = parseSpokiWebhookBody({
      version: 2,
      event: 'contact.updated',
      event_uuid: 'x',
      data: { id: 42413 },
    });
    expect(r.ok && r.value).toEqual({ kind: 'IGNORED', event: 'contact.updated', eventId: 'x' });
  });
});

describe('Webhook Spoki: forma piatta e riconoscimento', () => {
  it('la forma piatta { messageId | message_id | id | uuid, status } è un esito', () => {
    for (const chiave of ['messageId', 'message_id', 'id', 'uuid']) {
      const r = parseSpokiWebhookBody({ [chiave]: 'wa-1', status: 'sent', reason: 'ok' });
      expect(r.ok && r.value.kind === 'DELIVERY' && r.value.providerMessageId).toBe('wa-1');
      expect(r.ok && r.value.kind === 'DELIVERY' && r.value.state).toBe('SENT');
    }
    const numerico = parseSpokiWebhookBody({ id: 12345, status: 'read' });
    expect(
      numerico.ok && numerico.value.kind === 'DELIVERY' && numerico.value.providerMessageId,
    ).toBe('12345');
  });

  it('corpi vuoti, non oggetto o senza campi noti sono INVALID_REQUEST, mai un throw', () => {
    for (const corpo of [
      null,
      undefined,
      'x',
      42,
      [],
      {},
      { status: 'sent' },
      { messageId: 'a' },
    ]) {
      const r = parseSpokiWebhookBody(corpo);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.code).toBe('INVALID_REQUEST');
      expect(!r.ok && r.error.retryable).toBe(false);
    }
  });

  it('looksLikeSpokiEvent distingue gli eventi dalle risposte piatte del cliente', () => {
    expect(looksLikeSpokiEvent(outbound())).toBe(true);
    expect(looksLikeSpokiEvent({ messageId: 'wa-1', status: 'delivered' })).toBe(true);
    // La risposta di un cliente da un'automazione: numero e testo, nessun esito.
    expect(looksLikeSpokiEvent({ phone: '+393331234567', reply: 'Arrivato', secret: 's' })).toBe(
      false,
    );
    expect(looksLikeSpokiEvent(null)).toBe(false);
  });
});
