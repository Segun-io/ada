import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import type { AgentActivity, TerminalInfo } from "./types"
import { queryKeys } from "./query-client"
import { terminalApi } from "./api"

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

interface TerminalActivityEvent {
  terminal_id: string
  activity: AgentActivity
}

// =============================================================================
// Query Keys for Event-Driven Data
// =============================================================================

export const eventQueryKeys = {
  terminalOutput: (terminalId: string) => ["terminals", "output", terminalId] as const,
  terminalActivity: (terminalId: string) => ["terminals", "activity", terminalId] as const,
}

// =============================================================================
// Activity State with Idle Timeout
// =============================================================================

interface TerminalActivityState {
  activity: AgentActivity
  lastActivityAt: number
  previousActivity: AgentActivity
}

const IDLE_TIMEOUT = 5000

function computeDisplayActivity(state: TerminalActivityState | undefined): AgentActivity {
  if (!state) return "idle"

  const timeSinceActivity = Date.now() - state.lastActivityAt
  if (timeSinceActivity > IDLE_TIMEOUT) {
    return "idle"
  }

  return state.activity
}

// =============================================================================
// Activity Detection (until backend sends activity events)
// =============================================================================

const WAITING_PATTERNS = [
  "[Y/n]", "[y/N]", "(y/n)", "continue?", "Continue?",
  "permission", "Permission", "Do you want to", "Would you like",
  "Should I", "Proceed?", "proceed?", "approve", "Approve",
  "confirm", "Confirm", "Press Enter", "press enter",
]

const DONE_PATTERNS = [
  "Task completed", "task completed", "Done!", "Finished!",
  "Complete!", "Successfully completed",
]

function detectActivityFromOutput(data: string): AgentActivity {
  for (const pattern of WAITING_PATTERNS) {
    if (data.includes(pattern)) return "waiting_for_user"
  }
  for (const pattern of DONE_PATTERNS) {
    if (data.includes(pattern)) return "done"
  }
  return "running"
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

  // Detect and update activity based on output patterns
  const activity = detectActivityFromOutput(data)
  queryClient.setQueryData<TerminalActivityState>(
    eventQueryKeys.terminalActivity(terminal_id),
    (oldData) => ({
      activity,
      lastActivityAt: Date.now(),
      previousActivity: oldData?.activity ?? "idle",
    })
  )
}

function handleTerminalStatus(
  queryClient: QueryClient,
  event: TerminalStatusEvent
) {
  const { terminal_id, project_id, status } = event

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

  // If terminal stopped, update activity to idle
  if (status === "stopped") {
    queryClient.setQueryData<TerminalActivityState>(
      eventQueryKeys.terminalActivity(terminal_id),
      (oldData) => ({
        activity: "idle",
        lastActivityAt: oldData?.lastActivityAt ?? 0,
        previousActivity: oldData?.activity ?? "idle",
      })
    )
  }
}

function handleTerminalActivity(
  queryClient: QueryClient,
  event: TerminalActivityEvent
) {
  const { terminal_id, activity } = event

  queryClient.setQueryData<TerminalActivityState>(
    eventQueryKeys.terminalActivity(terminal_id),
    (oldData) => ({
      activity,
      lastActivityAt: Date.now(),
      previousActivity: oldData?.activity ?? "idle",
    })
  )
}

function handleTerminalClosed(
  queryClient: QueryClient,
  terminalId: string
) {
  // Find the project_id from cache
  const queries = queryClient.getQueriesData<TerminalInfo[]>({
    queryKey: ["terminals", "list"],
  })

  for (const [, terminals] of queries) {
    const terminal = terminals?.find((t) => t.id === terminalId)
    if (terminal) {
      handleTerminalStatus(queryClient, {
        terminal_id: terminalId,
        project_id: terminal.project_id,
        status: "stopped",
      })
      break
    }
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

    // Terminal activity events (if backend sends them)
    unlisteners.push(
      listen<TerminalActivityEvent>("terminal-activity", (event) => {
        handleTerminalActivity(queryClient, event.payload)
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

/**
 * Subscribe to terminal activity for a specific terminal.
 * Automatically computes idle state based on timeout.
 */
export function useTerminalActivity(
  terminalId: string,
  terminalStatus?: string
): AgentActivity {
  const { data } = useQuery({
    queryKey: eventQueryKeys.terminalActivity(terminalId),
    queryFn: (): TerminalActivityState => ({
      activity: "idle",
      lastActivityAt: 0,
      previousActivity: "idle",
    }),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    enabled: !!terminalId,
  })

  if (terminalStatus === "stopped") {
    return "idle"
  }

  return computeDisplayActivity(data)
}

/**
 * Hook for components that need to trigger idle timeout refresh.
 * Returns the raw activity state and a computed display activity.
 */
export function useTerminalActivityWithRefresh(
  terminalId: string,
  terminalStatus?: string
): { activity: AgentActivity; lastActivityAt: number } {
  const { data } = useQuery({
    queryKey: eventQueryKeys.terminalActivity(terminalId),
    queryFn: (): TerminalActivityState => ({
      activity: "idle",
      lastActivityAt: 0,
      previousActivity: "idle",
    }),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    enabled: !!terminalId,
    refetchOnWindowFocus: false,
  })

  const activity = terminalStatus === "stopped"
    ? "idle"
    : computeDisplayActivity(data)

  return {
    activity,
    lastActivityAt: data?.lastActivityAt ?? 0,
  }
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
 * Reset terminal activity to idle
 */
export function resetTerminalActivity(queryClient: QueryClient, terminalId: string) {
  queryClient.setQueryData<TerminalActivityState>(
    eventQueryKeys.terminalActivity(terminalId),
    {
      activity: "idle",
      lastActivityAt: 0,
      previousActivity: "idle",
    }
  )
}

/**
 * Remove terminal data from cache when terminal is closed
 */
export function removeTerminalFromCache(queryClient: QueryClient, terminalId: string) {
  queryClient.removeQueries({ queryKey: eventQueryKeys.terminalOutput(terminalId) })
  queryClient.removeQueries({ queryKey: eventQueryKeys.terminalActivity(terminalId) })
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
