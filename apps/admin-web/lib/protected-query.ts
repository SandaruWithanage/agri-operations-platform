import { QueryClient } from "@tanstack/react-query";

/** Ephemeral online server state only. Dexie remains the durable field outbox owner. */
export function createProtectedQueryClient() {
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
      mutations: { retry: false, gcTime: 0, networkMode: "always" },
    },
  });
}

export function farmerHistoryKey(
  accountId: string,
  authorizationEpoch: number,
  viewRevision: number,
  farmerId: string,
  cursor?: { beforeTime: string; beforeId: string },
) {
  return [
    "protected",
    { accountId, authorizationEpoch, viewRevision },
    "farmer-history",
    farmerId,
    { limit: 25, cursor: cursor ?? null },
  ] as const;
}
