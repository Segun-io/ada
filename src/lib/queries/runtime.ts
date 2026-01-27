import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { runtimeApi } from "../api"
import { queryKeys } from "../query-client"

export const runtimeConfigQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.runtime.config(),
    queryFn: () => runtimeApi.getConfig(),
    staleTime: 1000 * 60 * 5,
  })

export function useSetShellOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (shell: string | null) => runtimeApi.setShellOverride(shell),
    onSuccess: (config) => {
      queryClient.setQueryData(queryKeys.runtime.config(), config)
    },
  })
}
