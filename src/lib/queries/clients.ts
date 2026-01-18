import { queryOptions } from "@tanstack/react-query"
import { clientApi } from "../api"
import { queryKeys } from "../query-client"

// Query Options
export const clientsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.clients.list(),
    queryFn: () => clientApi.detectInstalled(), // Always detect installation status
    staleTime: 1000 * 60 * 5, // 5 minutes - installation state changes rarely
  })

export const clientQueryOptions = (clientId: string) =>
  queryOptions({
    queryKey: queryKeys.clients.detail(clientId),
    queryFn: () => clientApi.get(clientId),
    enabled: !!clientId,
  })
