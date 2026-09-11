'use client';

// Stato del monitor di campata in polling (2 s). Un monitor appeso in officina non ha nessuno che
// lo guardi da vicino: se il server smette di rispondere deve accorgersene e dirlo, invece di
// lasciare a schermo un codice vecchio che manderebbe il cliente alla campata sbagliata.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { POLLING_MS } from '@/config/constants';
import { fetchDisplayStatus } from '@/lib/api-client/client';

/** Poll consecutivi falliti dopo i quali il monitor si dichiara scollegato. */
export const OFFLINE_AFTER_FAILURES = 3;

export const bayDisplayKeys = {
  byBay: (bayRef: string) => ['bay-display', bayRef] as const,
};

export function useBayDisplay(bayRef: string, token?: string | null) {
  return useQuery({
    queryKey: bayDisplayKeys.byBay(bayRef),
    queryFn: () => fetchDisplayStatus(bayRef, token),
    refetchInterval: POLLING_MS.display,
    // Il monitor è sempre "in primo piano" anche quando il browser lo considera in background.
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
    retry: OFFLINE_AFTER_FAILURES - 1,
    retryDelay: 1_000,
  });
}
