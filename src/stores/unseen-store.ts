import { create } from "zustand"
import { useCallback, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

/**
 * Store for tracking unseen terminal output.
 * Uses Zustand for reliable React integration.
 */
interface UnseenState {
  // Set of terminal IDs with unseen output
  unseenTerminals: Set<string>
  // Map from terminal ID to project ID
  terminalToProject: Map<string, string>
  // Currently active/viewed terminal
  activeTerminalId: string | null

  // Actions
  registerTerminal: (terminalId: string, projectId: string) => void
  registerTerminals: (terminals: Array<{ id: string; project_id: string }>) => void
  unregisterTerminal: (terminalId: string) => void
  markUnseen: (terminalId: string) => void
  markSeen: (terminalId: string) => void
  setActiveTerminal: (terminalId: string) => void

  // Getters (for external use)
  hasUnseen: (terminalId: string) => boolean
  getProjectUnseenCount: (projectId: string) => number
  getProjectId: (terminalId: string) => string | undefined
}

export const useUnseenStore = create<UnseenState>((set, get) => ({
  unseenTerminals: new Set<string>(),
  terminalToProject: new Map<string, string>(),
  activeTerminalId: null,

  registerTerminal: (terminalId: string, projectId: string) => {
    const state = get()
    const existingProjectId = state.terminalToProject.get(terminalId)
    if (existingProjectId === projectId) return // Already registered

    set((state) => {
      const newTerminalToProject = new Map(state.terminalToProject)
      newTerminalToProject.set(terminalId, projectId)
      return { terminalToProject: newTerminalToProject }
    })
  },

  registerTerminals: (terminals) => {
    set((state) => {
      const newTerminalToProject = new Map(state.terminalToProject)
      for (const terminal of terminals) {
        newTerminalToProject.set(terminal.id, terminal.project_id)
      }
      return { terminalToProject: newTerminalToProject }
    })
  },

  unregisterTerminal: (terminalId: string) => {
    set((state) => {
      const newUnseenTerminals = new Set(state.unseenTerminals)
      const newTerminalToProject = new Map(state.terminalToProject)
      newUnseenTerminals.delete(terminalId)
      newTerminalToProject.delete(terminalId)
      return {
        unseenTerminals: newUnseenTerminals,
        terminalToProject: newTerminalToProject,
      }
    })
  },

  markUnseen: (terminalId: string) => {
    const state = get()
    // Don't mark if this is the active terminal
    if (state.activeTerminalId === terminalId) return

    set((state) => {
      const newUnseenTerminals = new Set(state.unseenTerminals)
      newUnseenTerminals.add(terminalId)
      return { unseenTerminals: newUnseenTerminals }
    })
  },

  markSeen: (terminalId: string) => {
    set((state) => {
      if (!state.unseenTerminals.has(terminalId)) return state
      const newUnseenTerminals = new Set(state.unseenTerminals)
      newUnseenTerminals.delete(terminalId)
      return { unseenTerminals: newUnseenTerminals }
    })
  },

  setActiveTerminal: (terminalId: string) => {
    set((state) => {
      const newUnseenTerminals = new Set(state.unseenTerminals)
      newUnseenTerminals.delete(terminalId)
      return {
        activeTerminalId: terminalId,
        unseenTerminals: newUnseenTerminals,
      }
    })
  },

  // Getters
  hasUnseen: (terminalId: string) => get().unseenTerminals.has(terminalId),
  getProjectUnseenCount: (projectId: string) => {
    const state = get()
    let count = 0
    for (const terminalId of state.unseenTerminals) {
      if (state.terminalToProject.get(terminalId) === projectId) {
        count++
      }
    }
    return count
  },
  getProjectId: (terminalId: string) => get().terminalToProject.get(terminalId),
}))

// =============================================================================
// Backwards-compatible singleton-style API
// =============================================================================

export const unseenStore = {
  registerTerminal: (terminalId: string, projectId: string) =>
    useUnseenStore.getState().registerTerminal(terminalId, projectId),
  registerTerminals: (terminals: Array<{ id: string; project_id: string }>) =>
    useUnseenStore.getState().registerTerminals(terminals),
  unregisterTerminal: (terminalId: string) =>
    useUnseenStore.getState().unregisterTerminal(terminalId),
  markUnseen: (terminalId: string) =>
    useUnseenStore.getState().markUnseen(terminalId),
  markSeen: (terminalId: string) =>
    useUnseenStore.getState().markSeen(terminalId),
  setActiveTerminal: (terminalId: string) =>
    useUnseenStore.getState().setActiveTerminal(terminalId),
  hasUnseen: (terminalId: string) =>
    useUnseenStore.getState().hasUnseen(terminalId),
  getProjectUnseenCount: (projectId: string) =>
    useUnseenStore.getState().getProjectUnseenCount(projectId),
  getProjectId: (terminalId: string) =>
    useUnseenStore.getState().getProjectId(terminalId),
}

// =============================================================================
// React Hooks
// =============================================================================

/**
 * Check if a terminal has unseen output.
 */
export function useTerminalHasUnseen(terminalId: string): boolean {
  return useUnseenStore(
    useCallback(
      (state) => (terminalId ? state.unseenTerminals.has(terminalId) : false),
      [terminalId]
    )
  )
}

/**
 * Get count of terminals with unseen output for a project.
 */
export function useProjectUnseenCount(projectId: string): number {
  const { unseenTerminals, terminalToProject } = useUnseenStore(
    useShallow((state) => ({
      unseenTerminals: state.unseenTerminals,
      terminalToProject: state.terminalToProject,
    }))
  )

  return useMemo(() => {
    if (!projectId) return 0
    let count = 0
    for (const terminalId of unseenTerminals) {
      if (terminalToProject.get(terminalId) === projectId) {
        count++
      }
    }
    return count
  }, [projectId, unseenTerminals, terminalToProject])
}

/**
 * Hook to mark a terminal as "seen" when viewing it.
 */
export function useMarkTerminalSeen() {
  const setActiveTerminal = useUnseenStore((state) => state.setActiveTerminal)
  return useCallback(
    (terminalId: string) => setActiveTerminal(terminalId),
    [setActiveTerminal]
  )
}
