'use client';

// Stato pubblico della pratica in polling (portale cliente): la pagina si aggiorna da sola
// mentre il cliente aspetta, senza ricaricare. Nessun dato personale transita da qui.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { POLLING_MS } from '@/config/constants';
import { ApiError, fetchPublicStatus } from '@/lib/api-client/client';
import type { PublicStatusProblem } from '@/modules/customer-portal/types';

/** Chiave della query: una per targa cercata. */
export const publicStatusKeys = {
  byPlate: (targa: string) => ['public-status', targa] as const,
};

/** Traduce un errore di rete o di API nel motivo mostrato al cliente. */
export function problemFrom(error: unknown): PublicStatusProblem {
  if (!(error instanceof ApiError)) {
    return 'unavailable';
  }
  if (error.status === 404) {
    return 'not-found';
  }
  if (error.status === 429) {
    return 'rate-limited';
  }
  if (error.status === 400 || error.code === 'VALIDATION') {
    return 'invalid-plate';
  }
  return 'unavailable';
}

/**
 * Interroga `/api/v1/public/status` ogni 5 secondi (`POLLING_MS.portal`).
 * Non ritenta gli errori definitivi (targa non valida o non trovata, troppe richieste):
 * riprovare non cambierebbe l'esito e aumenterebbe il carico.
 */
export function usePublicStatus(targa: string) {
  return useQuery({
    queryKey: publicStatusKeys.byPlate(targa),
    queryFn: () => fetchPublicStatus(targa),
    enabled: targa.length > 0,
    refetchInterval: POLLING_MS.portal,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => {
      const problem = problemFrom(error);
      return problem === 'unavailable' && failureCount < 2;
    },
  });
}
