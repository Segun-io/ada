import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { terminalApi } from "../api"
import { queryKeys } from "../query-client"
import type { CreateTerminalRequest } from "../types"

// Query Options
export const terminalsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.terminals.list(projectId),
    queryFn: () => terminalApi.list(projectId),
    enabled: !!projectId,
  })

export const terminalQueryOptions = (terminalId: string) =>
  queryOptions({
    queryKey: queryKeys.terminals.detail(terminalId),
    queryFn: () => terminalApi.get(terminalId),
    enabled: !!terminalId,
  })

export const terminalHistoryQueryOptions = (terminalId: string) =>
  queryOptions({
    queryKey: queryKeys.terminals.history(terminalId),
    queryFn: () => terminalApi.getHistory(terminalId),
    enabled: !!terminalId,
  })

// Mutations
export function useCreateTerminal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateTerminalRequest) => terminalApi.create(request),
    onSuccess: (newTerminal) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(newTerminal.project_id),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(newTerminal.project_id),
      })
    },
  })
}

export function useCreateMainTerminal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, clientId }: { projectId: string; clientId: string }) =>
      terminalApi.createMain(projectId, clientId),
    onSuccess: (newTerminal) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(newTerminal.project_id),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(newTerminal.project_id),
      })
    },
  })
}

export function useCloseTerminal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ terminalId, projectId }: { terminalId: string; projectId: string }) =>
      terminalApi.close(terminalId).then(() => ({ terminalId, projectId })),
    onMutate: async ({ terminalId, projectId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.terminals.list(projectId),
      })

      // Snapshot the previous value
      const previousTerminals = queryClient.getQueryData(
        queryKeys.terminals.list(projectId)
      )

      // Optimistically remove the terminal from the list
      queryClient.setQueryData(
        queryKeys.terminals.list(projectId),
        (old: unknown) => {
          if (!Array.isArray(old)) return old
          return old.filter((t: { id: string }) => t.id !== terminalId)
        }
      )

      return { previousTerminals }
    },
    onError: (_err, { projectId }, context) => {
      // Rollback on error
      if (context?.previousTerminals) {
        queryClient.setQueryData(
          queryKeys.terminals.list(projectId),
          context.previousTerminals
        )
      }
    },
    onSettled: (_, __, { projectId }) => {
      // Always refetch to ensure cache is in sync
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(projectId),
      })
    },
  })
}

export function useRestartTerminal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (terminalId: string) => terminalApi.restart(terminalId),
    onSuccess: (updatedTerminal) => {
      // Clear terminal output cache for fresh start
      queryClient.setQueryData(
        ["terminals", "output", updatedTerminal.id],
        []
      )
      // Reset activity state
      queryClient.setQueryData(
        ["terminals", "activity", updatedTerminal.id],
        { activity: "idle", lastActivityAt: 0, previousActivity: "idle" }
      )
      // Update terminal detail
      queryClient.setQueryData(
        queryKeys.terminals.detail(updatedTerminal.id),
        updatedTerminal
      )
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(updatedTerminal.project_id),
      })
    },
  })
}

/**
 * Reconnect a terminal that lost its PTY connection.
 * Unlike restart, this preserves the terminal output history.
 * Use this for automatic recovery when PTY is not running.
 */
export function useReconnectTerminal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (terminalId: string) => {
      console.log(
        `%c[RECONNECT MUTATION]%c Calling terminalApi.restart`,
        "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px;",
        "",
        terminalId
      )

      // Add timeout to prevent hanging forever if daemon dies
      const timeoutMs = 15000
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Reconnect timed out after 15s")), timeoutMs)
      })

      try {
        const result = await Promise.race([
          terminalApi.restart(terminalId),
          timeoutPromise,
        ])
        console.log(
          `%c[RECONNECT MUTATION]%c terminalApi.restart resolved`,
          "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px;",
          "color: #22c55e;",
          result
        )
        return result
      } catch (err) {
        console.error(
          `%c[RECONNECT MUTATION]%c terminalApi.restart rejected/timed out`,
          "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px;",
          "color: #ef4444;",
          err
        )
        throw err
      }
    },
    onSuccess: (updatedTerminal) => {
      console.log(
        `%c[RECONNECT MUTATION]%c onSuccess`,
        "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px;",
        "color: #22c55e;",
        updatedTerminal.id
      )
      // DO NOT clear terminal output - preserve history for reconnect
      // Just update terminal detail and status
      queryClient.setQueryData(
        queryKeys.terminals.detail(updatedTerminal.id),
        updatedTerminal
      )
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(updatedTerminal.project_id),
      })
    },
    onError: (err) => {
      console.error(
        `%c[RECONNECT MUTATION]%c onError`,
        "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px;",
        "color: #ef4444;",
        err
      )
    },
  })
}

export function useMarkTerminalStopped() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (terminalId: string) => terminalApi.markStopped(terminalId),
    onSuccess: (updatedTerminal) => {
      queryClient.setQueryData(
        queryKeys.terminals.detail(updatedTerminal.id),
        updatedTerminal
      )
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(updatedTerminal.project_id),
      })
    },
  })
}

export function useSwitchTerminalAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ terminalId, newClientId }: { terminalId: string; newClientId: string }) =>
      terminalApi.switchAgent(terminalId, newClientId),
    onSuccess: (updatedTerminal) => {
      queryClient.setQueryData(
        queryKeys.terminals.detail(updatedTerminal.id),
        updatedTerminal
      )
      queryClient.invalidateQueries({
        queryKey: queryKeys.terminals.list(updatedTerminal.project_id),
      })
    },
  })
}

export function useWriteTerminal() {
  return useMutation({
    mutationFn: ({ terminalId, data }: { terminalId: string; data: string }) =>
      terminalApi.write(terminalId, data),
  })
}

export function useResizeTerminal() {
  return useMutation({
    mutationFn: terminalApi.resize,
  })
}
