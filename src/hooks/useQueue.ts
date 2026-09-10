'use client';

// Coda della giornata in polling (3 s): la fonte di verità è il server, il client tiene una cache.
// `keepPreviousData` evita lo sfarfallio quando cambiano filtri o vista.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { POLLING_MS } from '@/config/constants';
import { fetchQueue } from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import type { QueueParams } from '@/modules/reception/types';

export function useQueue(params: QueueParams) {
  return useQuery({
    queryKey: queueKeys.list(params),
    queryFn: () => fetchQueue(params),
    refetchInterval: POLLING_MS.dashboard,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });
}
