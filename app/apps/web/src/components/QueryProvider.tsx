'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      });
    // Brain data changes from other personas' windows: always refetch on focus + poll every 5 s.
    for (const key of ['brain-notes', 'brain-promotion-requests', 'brain-graph']) {
      client.setQueryDefaults([key], {
        staleTime: 0,
        refetchOnWindowFocus: true,
        refetchInterval: 5000,
      });
    }
    return client;
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
