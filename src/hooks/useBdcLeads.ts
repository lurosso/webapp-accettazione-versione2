'use client';

// Lead del BDC in polling: il reparto tiene la pagina aperta tutto il giorno e le assenze
// arrivano mentre è aperta. Il ritmo è più lento della coda in officina (10 s contro 3 s): qui
// nessuno aspetta davanti a un banco, e una lista che si riordina troppo spesso si telefona male.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchBdcLeads, type BdcLeadsParams } from '@/lib/api-client/client';

/** Intervallo di aggiornamento del cruscotto BDC (ms). */
export const BDC_POLLING_MS = 10_000;

export const bdcKeys = {
  all: ['bdc-leads'] as const,
  list: (params: BdcLeadsParams) =>
    ['bdc-leads', params.businessDate, params.includeHandled] as const,
};

export function useBdcLeads(params: BdcLeadsParams) {
  return useQuery({
    queryKey: bdcKeys.list(params),
    queryFn: () => fetchBdcLeads(params),
    refetchInterval: BDC_POLLING_MS,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });
}
