'use client';

// Tabellone della sala d'attesa in polling (2 s, come i monitor di campata): chi è chiamato e
// quali sono i prossimi turni. Se il server non risponde lo schermo lo dichiara, invece di
// mostrare chiamate non più valide.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { POLLING_MS } from '@/config/constants';
import { OFFLINE_AFTER_FAILURES } from '@/hooks/useBayDisplay';
import { fetchWaitingBoard } from '@/lib/api-client/client';

export const waitingBoardKeys = {
  board: (nextCount: number) => ['waiting-board', nextCount] as const,
};

export function useWaitingBoard(nextCount: number) {
  return useQuery({
    queryKey: waitingBoardKeys.board(nextCount),
    queryFn: () => fetchWaitingBoard(nextCount),
    refetchInterval: POLLING_MS.display,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
    retry: OFFLINE_AFTER_FAILURES - 1,
    retryDelay: 1_000,
  });
}
