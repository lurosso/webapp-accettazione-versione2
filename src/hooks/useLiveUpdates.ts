'use client';

// Aggiornamenti in tempo reale via SSE, con il polling come rete di sicurezza.
//
// Il flusso porta segnali, non dati: quando arriva "pratica cambiata" si invalidano le query
// interessate e TanStack Query rilegge dall'endpoint di sempre. Se la connessione cade il browser
// riprova da solo e, nel frattempo, il polling già attivo continua a tenere aggiornata la
// schermata: peggiora la reattività, non la correttezza. È la stessa regola del resto del
// sistema — nessun pezzo può fermare l'officina.
import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { DomainEventType } from '@/domain/events';

/** Stato della connessione, mostrato in dashboard come "in diretta" o "aggiornamento periodico". */
export type LiveStatus = 'connecting' | 'live' | 'polling';

export interface LiveUpdatesOptions {
  /** Indirizzo del flusso: `/api/v1/events/stream` con sessione, `public/...` per i kiosk. */
  readonly url: string;
  /** Tipi che interessano a questa schermata; assente = tutti quelli che arrivano. */
  readonly types?: readonly DomainEventType[];
  /** Query da rileggere quando arriva un segnale utile. */
  readonly invalidate: readonly QueryKey[];
}

export function useLiveUpdates({ url, types, invalidate }: LiveUpdatesOptions): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  // Le chiavi sono array: si serializzano per non riaprire il flusso a ogni render.
  const chiavi = JSON.stringify(invalidate);
  const tipi = types === undefined ? '' : types.join(',');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
      // Browser senza SSE (o rendering sul server): resta il polling. Lo stato si aggiorna fuori
      // dal corpo dell'effetto, per non innescare un secondo render a catena.
      const avviso = setTimeout(() => setStatus('polling'), 0);
      return () => clearTimeout(avviso);
    }

    const source = new EventSource(url);
    const daRileggere: QueryKey[] = JSON.parse(chiavi) as QueryKey[];
    const interessano = tipi === '' ? null : new Set(tipi.split(','));

    const onSignal = (event: MessageEvent<string>): void => {
      const tipo = event.type;
      if (interessano !== null && !interessano.has(tipo)) {
        return;
      }
      for (const key of daRileggere) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };

    // Un handler per tipo: gli eventi SSE hanno un nome, quindi `onmessage` non li vede.
    const tipiAscoltati =
      interessano === null
        ? ['APPOINTMENT_STATUS_CHANGED', 'APPOINTMENT_CREATED', 'BUSINESS_DAY_CLOSED']
        : [...interessano];
    for (const tipo of tipiAscoltati) {
      source.addEventListener(tipo, onSignal as EventListener);
    }

    source.onopen = () => setStatus('live');
    source.onerror = () => {
      // EventSource riprova da solo: qui si dice solo alla UI che per ora vale il polling.
      setStatus(source.readyState === EventSource.CLOSED ? 'polling' : 'connecting');
    };

    return () => {
      for (const tipo of tipiAscoltati) {
        source.removeEventListener(tipo, onSignal as EventListener);
      }
      source.close();
    };
  }, [url, chiavi, tipi, queryClient]);

  return status;
}
