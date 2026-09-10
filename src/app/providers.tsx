'use client';

// Provider client globali: TanStack Query (cache e polling della coda).
// Un QueryClient per sessione di pagina, creato una sola volta.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { readonly children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
