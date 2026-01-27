import { invoke } from "@tauri-apps/api/core"
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ConnectionState, DaemonStatusInfo } from "@/lib/types"

/**
 * Query to check daemon status
 */
export const daemonStatusQuery = queryOptions({
  queryKey: ["daemon", "status"],
  queryFn: () => invoke<DaemonStatusInfo>("check_daemon_status"),
  retry: false,
  staleTime: 5000, // Cache for 5 seconds
})

/**
 * Query to get connection state
 */
export const connectionStateQuery = queryOptions({
  queryKey: ["daemon", "connectionState"],
  queryFn: () => invoke<ConnectionState>("get_connection_state"),
  retry: false,
  staleTime: 1000, // Cache for 1 second
})

/**
 * Mutation to connect to daemon
 */
export function useConnectDaemon() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => invoke<DaemonStatusInfo>("connect_to_daemon"),
    onSuccess: () => {
      // Invalidate status queries on successful connection
      queryClient.invalidateQueries({ queryKey: ["daemon"] })
    },
  })
}

/**
 * Mutation to start daemon
 */
export function useStartDaemon() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => invoke("start_daemon"),
    onSuccess: () => {
      // Invalidate status queries after starting daemon
      queryClient.invalidateQueries({ queryKey: ["daemon"] })
    },
  })
}
