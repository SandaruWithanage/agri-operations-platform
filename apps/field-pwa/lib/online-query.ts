import { QueryClient } from "@tanstack/react-query";
/** Online session display only; never persists credentials or a durable mutation queue. */
export function createFieldQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        networkMode: "always",
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}
