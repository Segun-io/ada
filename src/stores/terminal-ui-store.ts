import { create } from "zustand"
import type { AgentActivity } from "@/lib/types"
import { terminalApi } from "@/lib/api"

// Idle timeout in milliseconds (5 seconds of no output = idle)
const IDLE_TIMEOUT = 5000

interface TerminalActivityState {
  activity: AgentActivity
  lastActivityAt: number
}

interface TerminalUIState {
  activeTerminalId: string | null
  terminalOutputs: Record<string, string[]>
  terminalActivity: Record<string, TerminalActivityState>
  sidebarCollapsed: boolean

  // Actions
  setActiveTerminal: (terminalId: string | null) => void
  initializeTerminals: (terminalIds: string[], mainTerminalId: string | null, lastVisitedTerminalId?: string | null) => void
  appendOutput: (terminalId: string, data: string) => void
  loadTerminalHistory: (terminalId: string) => Promise<void>
  writeToTerminal: (terminalId: string, data: string) => Promise<void>
  getActivity: (terminalId: string, terminalStatus?: string) => AgentActivity
  clearTerminalOutput: (terminalId: string) => void
  removeTerminal: (terminalId: string, mainTerminalId: string | null, remainingTerminalIds: string[]) => void
  resetActivityToIdle: (terminalId: string) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

// Helper to detect activity type from output
function detectActivityFromOutput(data: string): AgentActivity {
  // Check for waiting_for_user patterns (prompts requiring user input)
  const waitingPatterns = [
    "[Y/n]",
    "[y/N]",
    "(y/n)",
    "continue?",
    "Continue?",
    "permission",
    "Permission",
    "Do you want to",
    "Would you like",
    "Should I",
    "Proceed?",
    "proceed?",
    "approve",
    "Approve",
    "confirm",
    "Confirm",
    "Press Enter",
    "press enter",
  ]

  for (const pattern of waitingPatterns) {
    if (data.includes(pattern)) {
      return "waiting_for_user"
    }
  }

  // Check for done patterns
  const donePatterns = [
    "Task completed",
    "task completed",
    "Done!",
    "Finished!",
    "Complete!",
    "Successfully completed",
  ]

  for (const pattern of donePatterns) {
    if (data.includes(pattern)) {
      return "done"
    }
  }

  // Default to running for any active output
  return "running"
}

export const useTerminalUIStore = create<TerminalUIState>((set, get) => ({
  activeTerminalId: null,
  terminalOutputs: {},
  terminalActivity: {},
  sidebarCollapsed: false,

  setActiveTerminal: (terminalId) => set({ activeTerminalId: terminalId }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  initializeTerminals: (terminalIds, mainTerminalId, lastVisitedTerminalId) => {
    const activityState: Record<string, TerminalActivityState> = {}
    for (const id of terminalIds) {
      activityState[id] = {
        activity: "idle",
        lastActivityAt: 0,
      }
    }

    set((state) => {
      // Set active terminal based on priority:
      // 1. Keep current if valid
      // 2. Use last visited if valid
      // 3. Fall back to main terminal
      // 4. Fall back to first terminal
      let activeId = state.activeTerminalId
      if (!activeId || !terminalIds.includes(activeId)) {
        if (lastVisitedTerminalId && terminalIds.includes(lastVisitedTerminalId)) {
          activeId = lastVisitedTerminalId
        } else {
          activeId = mainTerminalId ?? terminalIds[0] ?? null
        }
      }

      return {
        terminalActivity: activityState,
        activeTerminalId: activeId,
      }
    })
  },

  appendOutput: (terminalId, data) => {
    const activity = detectActivityFromOutput(data)
    set((state) => ({
      terminalOutputs: {
        ...state.terminalOutputs,
        [terminalId]: [...(state.terminalOutputs[terminalId] || []), data],
      },
      terminalActivity: {
        ...state.terminalActivity,
        [terminalId]: {
          activity,
          lastActivityAt: Date.now(),
        },
      },
    }))
  },

  loadTerminalHistory: async (terminalId) => {
    try {
      const history = await terminalApi.getHistory(terminalId)
      set((state) => ({
        terminalOutputs: {
          ...state.terminalOutputs,
          [terminalId]: history,
        },
      }))
    } catch (error) {
      console.error("Failed to load terminal history:", error)
    }
  },

  writeToTerminal: async (terminalId, data) => {
    await terminalApi.write(terminalId, data)
  },

  getActivity: (terminalId, terminalStatus) => {
    const state = get()
    const activityState = state.terminalActivity[terminalId]

    // If terminal is stopped, return idle
    if (terminalStatus === "stopped") {
      return "idle"
    }

    // If no activity state, return idle
    if (!activityState) {
      return "idle"
    }

    // Check if idle timeout has passed
    const timeSinceActivity = Date.now() - activityState.lastActivityAt
    if (timeSinceActivity > IDLE_TIMEOUT) {
      return "idle"
    }

    return activityState.activity
  },

  clearTerminalOutput: (terminalId) => {
    set((state) => ({
      terminalOutputs: {
        ...state.terminalOutputs,
        [terminalId]: [],
      },
      terminalActivity: {
        ...state.terminalActivity,
        [terminalId]: { activity: "idle", lastActivityAt: Date.now() },
      },
    }))
  },

  removeTerminal: (terminalId, mainTerminalId, remainingTerminalIds) => {
    set((state) => {
      const { [terminalId]: _unusedOutput, ...outputs } = state.terminalOutputs
      const { [terminalId]: _unusedActivity, ...activities } = state.terminalActivity
      void _unusedOutput
      void _unusedActivity

      // If closing active terminal, switch to main or first terminal
      let newActiveId = state.activeTerminalId
      if (state.activeTerminalId === terminalId) {
        newActiveId = mainTerminalId ?? remainingTerminalIds[0] ?? null
      }

      return {
        terminalOutputs: outputs,
        terminalActivity: activities,
        activeTerminalId: newActiveId,
      }
    })
  },

  resetActivityToIdle: (terminalId) => {
    set((state) => ({
      terminalActivity: {
        ...state.terminalActivity,
        [terminalId]: { activity: "idle", lastActivityAt: 0 },
      },
    }))
  },
}))
