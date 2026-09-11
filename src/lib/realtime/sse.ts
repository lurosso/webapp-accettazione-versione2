// Trasmissione di eventi al browser (Server-Sent Events).
//
// SSE e non WebSocket: il flusso è a senso unico (il server racconta, il client ascolta), passa
// dai proxy come una normale risposta HTTP e il browser si riconnette da solo. Per quello che
// serve qui — dire "qualcosa è cambiato" a una dashboard e a quattro monitor in officina — è la
// scelta più semplice che regge un riavvio del server senza che nessuno se ne accorga.
//
// Sul filo viaggia un SEGNALE, non i dati: tipo dell'evento e poco altro. Chi riceve rilegge dal
// proprio endpoint, che è già quello autorizzato per lui. Così il monitor in sala d'attesa non
// può ricevere un nome o un telefono nemmeno per errore, e l'SSE non diventa una seconda API da
// tenere allineata.
import type { DomainEvent, DomainEventType } from '@/domain/events';
import type { IEventBus } from '@/services/interfaces/IEventBus';

/** Ogni quanto mandare un commento di tenuta in vita (i proxy chiudono le connessioni mute). */
export const SSE_HEARTBEAT_MS = 15_000;

/** Segnale trasmesso ai client: nessun dato personale, solo cosa è cambiato. */
export interface SseSignal {
  readonly seq: number;
  readonly type: DomainEventType;
  readonly occurredAt: string;
  /** Pratica coinvolta: presente solo sul canale autenticato. */
  readonly appointmentId?: string;
  /** Giornata operativa, quando l'evento la indica (chiusura di giornata). */
  readonly businessDate?: string;
}

/** Converte un evento di dominio nel segnale da trasmettere. */
export function toSignal(event: DomainEvent, includeIds: boolean): SseSignal {
  const base: SseSignal = {
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt,
  };
  if (event.type === 'BUSINESS_DAY_CLOSED') {
    return { ...base, businessDate: event.businessDate };
  }
  if (includeIds && 'appointmentId' in event) {
    return { ...base, appointmentId: event.appointmentId };
  }
  return base;
}

export interface SseStreamOptions {
  readonly bus: IEventBus;
  /** Interruzione della richiesta (scheda chiusa, monitor spento). */
  readonly signal: AbortSignal;
  /** Ultimo `seq` già visto dal client (intestazione `Last-Event-ID`): riparte da lì. */
  readonly lastEventId: number;
  /** Tipi da trasmettere; assente = tutti. */
  readonly types?: readonly DomainEventType[];
  /** True sul canale autenticato: aggiunge gli identificativi delle pratiche. */
  readonly includeIds: boolean;
}

/**
 * Costruisce il flusso SSE a partire dal bus. Il resume via `Last-Event-ID` non è un lusso: un
 * monitor che perde la rete per dieci secondi deve ritrovare quello che si è perso, non aspettare
 * il prossimo cambio di stato.
 */
export function createEventStream(options: SseStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const interessa = (type: DomainEventType): boolean =>
    options.types === undefined || options.types.includes(type);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let chiuso = false;
      const invia = (testo: string): void => {
        if (chiuso) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(testo));
        } catch {
          // Client sparito fra un controllo e l'altro: si chiude e basta.
          chiudi();
        }
      };

      const inviaEvento = (event: DomainEvent): void => {
        if (!interessa(event.type)) {
          return;
        }
        const dati = JSON.stringify(toSignal(event, options.includeIds));
        invia(`id: ${event.seq}\nevent: ${event.type}\ndata: ${dati}\n\n`);
      };

      // Commento iniziale: apre subito la risposta, così il browser considera stabilita la
      // connessione anche in una giornata senza eventi.
      invia(`retry: 3000\n: flusso aperto\n\n`);

      // Recupero di quanto perso durante una disconnessione. Solo con un `Last-Event-ID`: un
      // client che apre adesso ha appena letto i dati dal proprio endpoint, e rispedirgli tutto
      // l'arretrato lo farebbe solo rileggere a vuoto.
      if (options.lastEventId > 0) {
        for (const event of options.bus.listSince(options.lastEventId)) {
          inviaEvento(event);
        }
      }

      const unsubscribe = options.bus.subscribe(inviaEvento);
      const heartbeat = setInterval(() => invia(`: battito\n\n`), SSE_HEARTBEAT_MS);

      function chiudi(): void {
        if (chiuso) {
          return;
        }
        chiuso = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Già chiuso dal client.
        }
      }

      options.signal.addEventListener('abort', chiudi, { once: true });
    },
  });
}

/** Intestazioni obbligatorie di una risposta SSE. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
  // Disattiva il buffering di nginx: senza, i segnali arrivano a blocchi e il "tempo reale" sparisce.
  'x-accel-buffering': 'no',
};

/** Legge `Last-Event-ID` (o `?since=`) come numero, 0 se assente o non valido. */
export function parseLastEventId(header: string | null, query: string | null): number {
  const grezzo = header ?? query ?? '';
  const n = Number.parseInt(grezzo, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
