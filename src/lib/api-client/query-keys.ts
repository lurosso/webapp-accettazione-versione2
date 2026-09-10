// Chiavi delle query TanStack: un solo punto per invalidare la coda dopo ogni mutazione.
import type { QueueParams } from '@/modules/reception/types';

export const queueKeys = {
  all: ['queue'] as const,
  list: (params: QueueParams) => ['queue', params.date, params.deskId, params.view] as const,
};
