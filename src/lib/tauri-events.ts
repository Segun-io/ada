import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import type { TerminalInfo } from "./types"
import { queryKeys } from "./query-client"
import { terminalApi } from "./api"
import { unseenStore } from "@/stores/unseen-store"

// Re-export hooks from unseen store for convenience
export {
  useTerminalHasUnseen,
  useProjectUnseenCount,
  useMarkTerminalSeen,
  unseenStore,
} from "@/stores/unseen-store"

// =============================================================================
// Event Types from Tauri Backend
// =============================================================================

interface TerminalOutputEvent {
  terminal_id: string
  data: string
}

interface TerminalStatusEvent {
  terminal_id: string
  project_id: string
  status: "running" | "stopped"
}

// =============================================================================
// Query Keys for Event-Driven Data
// =============================================================================

export const eventQueryKeys = {
  terminalOutput: (terminalId: string) => ["terminals", "output", terminalId] as const,
}

// =============================================================================
// Event Handlers
// =============================================================================

function handleTerminalOutput(
  queryClient: QueryClient,
  event: TerminalOutputEvent
) {
  const { terminal_id, data } = event

  // Append output to the terminal's output cache
  queryClient.setQueryData<string[]>(
    eventQueryKeys.terminalOutput(terminal_id),
    (oldData = []) => [...oldData, data]
  )

  // Mark as unseen (store handles active terminal check internally)
  unseenStore.markUnseen(terminal_id)
}

function handleTerminalStatus(
  queryClient: QueryClient,
  event: TerminalStatusEvent
) {
  const { terminal_id, project_id, status } = event

  // Register terminal -> project mapping
  unseenStore.registerTerminal(terminal_id, project_id)

  // Update the terminal in the terminals list cache
  queryClient.setQueryData<TerminalInfo[]>(
    queryKeys.terminals.list(project_id),
    (oldData) => {
      if (!oldData) return oldData
      return oldData.map((t) =>
        t.id === terminal_id ? { ...t, status } : t
      )
    }
  )

  // Also update the individual terminal detail if cached
  queryClient.setQueryData<TerminalInfo>(
    queryKeys.terminals.detail(terminal_id),
    (oldData) => {
      if (!oldData) return oldData
      return { ...oldData, status }
    }
  )
}

function handleTerminalClosed(
  queryClient: QueryClient,
  terminalId: string
) {
  // Get project ID from our store - O(1)
  const projectId = unseenStore.getProjectId(terminalId)

  if (projectId) {
    handleTerminalStatus(queryClient, {
      terminal_id: terminalId,
      project_id: projectId,
      status: "stopped",
    })
  }
}

// =============================================================================
// Main Hook - Initialize Event Listeners
// =============================================================================

/**
 * Initialize Tauri event listeners. Call once at app root.
 * Uses useEffect to properly manage listener lifecycle.
 */
export function useTauriEvents(queryClient: QueryClient) {
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = []

    // Terminal output events
    unlisteners.push(
      listen<TerminalOutputEvent>("terminal-output", (event) => {
        handleTerminalOutput(queryClient, event.payload)
      })
    )

    // Terminal closed events (backward compatibility - just sends ID)
    unlisteners.push(
      listen<string>("terminal-closed", (event) => {
        handleTerminalClosed(queryClient, event.payload)
      })
    )

    // Terminal status events (if backend sends them)
    unlisteners.push(
      listen<TerminalStatusEvent>("terminal-status", (event) => {
        handleTerminalStatus(queryClient, event.payload)
      })
    )

    // Cleanup on unmount
    return () => {
      unlisteners.forEach((unlisten) => {
        unlisten.then((fn) => fn())
      })
    }
  }, [queryClient])
}

// =============================================================================
// Consumer Hooks
// =============================================================================

/**
 * Subscribe to terminal output for a specific terminal.
 * Automatically fetches history from backend on first load.
 * Live updates are appended via Tauri event listeners.
 */
export function useTerminalOutput(terminalId: string): string[] {
  const { data = [] } = useQuery({
    queryKey: eventQueryKeys.terminalOutput(terminalId),
    queryFn: () => terminalApi.getHistory(terminalId).catch(() => []),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    enabled: !!terminalId,
  })

  return data
}

// =============================================================================
// Utility Functions for Direct Cache Access
// =============================================================================

/**
 * Clear terminal output from cache (e.g., when switching agents)
 */
export function clearTerminalOutput(queryClient: QueryClient, terminalId: string) {
  queryClient.setQueryData(eventQueryKeys.terminalOutput(terminalId), [])
}

/**
 * Remove terminal data from cache when terminal is closed
 */
export function removeTerminalFromCache(queryClient: QueryClient, terminalId: string) {
  queryClient.removeQueries({ queryKey: eventQueryKeys.terminalOutput(terminalId) })
  unseenStore.unregisterTerminal(terminalId)
}

/**
 * Load terminal history into the output cache (for imperative use)
 */
export function loadTerminalHistory(
  queryClient: QueryClient,
  terminalId: string,
  history: string[]
) {
  queryClient.setQueryData(eventQueryKeys.terminalOutput(terminalId), history)
}

/**
 * Mark a terminal as seen (for imperative use)
 */
export function markTerminalSeen(
  _queryClient: QueryClient,
  terminalId: string
) {
  unseenStore.setActiveTerminal(terminalId)
}
