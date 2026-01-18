import { create } from "zustand"
import type { TerminalInfo, CreateTerminalRequest, AgentActivity } from "@/lib/types"
import { terminalApi } from "@/lib/api"

// Idle timeout in milliseconds (5 seconds of no output = idle)
const IDLE_TIMEOUT = 5000

interface TerminalActivityState {
  activity: AgentActivity
  lastActivityAt: number
}

interface TerminalState {
  terminals: TerminalInfo[]
  activeTerminalId: string | null
  terminalOutputs: Record<string, string[]>
  terminalActivity: Record<string, TerminalActivityState>
  isLoading: boolean
  error: string | null

  // Actions
  loadTerminals: (projectId: string) => Promise<void>
  createTerminal: (request: CreateTerminalRequest) => Promise<TerminalInfo>
  closeTerminal: (terminalId: string) => Promise<void>
  restartTerminal: (terminalId: string) => Promise<TerminalInfo>
  markTerminalStopped: (terminalId: string) => Promise<void>
  switchTerminalAgent: (terminalId: string, newClientId: string) => Promise<TerminalInfo>
  loadTerminalHistory: (terminalId: string) => Promise<void>
  setActiveTerminal: (terminalId: string | null) => void
  writeToTerminal: (terminalId: string, data: string) => Promise<void>
  appendOutput: (terminalId: string, data: string) => void
  getActivity: (terminalId: string) => AgentActivity
  clearError: () => void
}

// Helper to detect activity type from output
function detectActivityFromOutput(data: string): AgentActivity {
  // Check for thinking indicators (Claude-specific patterns)
  if (
    data.includes("Thinking") ||
    data.includes("thinking...") ||
    data.includes("⠋") ||
    data.includes("⠙") ||
    data.includes("⠹") ||
    data.includes("⠸") ||
    data.includes("⠼") ||
    data.includes("⠴") ||
    data.includes("⠦") ||
    data.includes("⠧") ||
    data.includes("⠇") ||
    data.includes("⠏")
  ) {
    return "thinking"
  }
  return "active"
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: [],
  activeTerminalId: null,
  terminalOutputs: {},
  terminalActivity: {},
  isLoading: false,
  error: null,

  loadTerminals: async (projectId: string) => {
    set({ isLoading: true, error: null })
    try {
      const terminals = await terminalApi.list(projectId)

      // Initialize activity state for all terminals
      const activityState: Record<string, TerminalActivityState> = {}
      for (const terminal of terminals) {
        activityState[terminal.id] = {
          activity: terminal.status === "running" ? "idle" : "idle",
          lastActivityAt: 0,
        }
      }

      set({ terminals, terminalActivity: activityState, isLoading: false })

      // Set first terminal as active if none selected
      if (terminals.length > 0 && !get().activeTerminalId) {
        set({ activeTerminalId: terminals[0].id })
      }
    } catch (error) {
      set({ error: String(error), isLoading: false })
    }
  },

  createTerminal: async (request: CreateTerminalRequest) => {
    set({ isLoading: true, error: null })
    try {
      const terminal = await terminalApi.create(request)
      set((state) => ({
        terminals: [...state.terminals, terminal],
        activeTerminalId: terminal.id,
        terminalOutputs: { ...state.terminalOutputs, [terminal.id]: [] },
        terminalActivity: {
          ...state.terminalActivity,
          [terminal.id]: { activity: "idle", lastActivityAt: Date.now() },
        },
        isLoading: false,
      }))
      return terminal
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  closeTerminal: async (terminalId: string) => {
    set({ isLoading: true, error: null })
    try {
      await terminalApi.close(terminalId)
      set((state) => {
        const terminals = state.terminals.filter((t) => t.id !== terminalId)
        const { [terminalId]: _output, ...outputs } = state.terminalOutputs
        const { [terminalId]: _activity, ...activities } = state.terminalActivity
        return {
          terminals,
          terminalOutputs: outputs,
          terminalActivity: activities,
          activeTerminalId:
            state.activeTerminalId === terminalId
              ? terminals[0]?.id ?? null
              : state.activeTerminalId,
          isLoading: false,
        }
      })
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  restartTerminal: async (terminalId: string) => {
    set({ isLoading: true, error: null })
    try {
      const terminal = await terminalApi.restart(terminalId)
      set((state) => ({
        terminals: state.terminals.map((t) =>
          t.id === terminalId ? terminal : t
        ),
        terminalActivity: {
          ...state.terminalActivity,
          [terminalId]: { activity: "idle", lastActivityAt: Date.now() },
        },
        isLoading: false,
      }))
      return terminal
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  markTerminalStopped: async (terminalId: string) => {
    try {
      const terminal = await terminalApi.markStopped(terminalId)
      set((state) => ({
        terminals: state.terminals.map((t) =>
          t.id === terminalId ? terminal : t
        ),
        terminalActivity: {
          ...state.terminalActivity,
          [terminalId]: { activity: "idle", lastActivityAt: 0 },
        },
      }))
    } catch (error) {
      console.error("Failed to mark terminal stopped:", error)
    }
  },

  switchTerminalAgent: async (terminalId: string, newClientId: string) => {
    set({ isLoading: true, error: null })
    try {
      const terminal = await terminalApi.switchAgent(terminalId, newClientId)
      set((state) => ({
        terminals: state.terminals.map((t) =>
          t.id === terminalId ? terminal : t
        ),
        terminalOutputs: {
          ...state.terminalOutputs,
          [terminalId]: [], // Clear output for new agent
        },
        terminalActivity: {
          ...state.terminalActivity,
          [terminalId]: { activity: "idle", lastActivityAt: Date.now() },
        },
        isLoading: false,
      }))
      return terminal
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  loadTerminalHistory: async (terminalId: string) => {
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

  setActiveTerminal: (terminalId) => set({ activeTerminalId: terminalId }),

  writeToTerminal: async (terminalId: string, data: string) => {
    try {
      await terminalApi.write(terminalId, data)
    } catch (error) {
      set({ error: String(error) })
      throw error
    }
  },

  appendOutput: (terminalId: string, data: string) => {
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

  getActivity: (terminalId: string): AgentActivity => {
    const state = get()
    const terminal = state.terminals.find((t) => t.id === terminalId)
    const activityState = state.terminalActivity[terminalId]

    // If terminal is stopped, return idle
    if (terminal?.status === "stopped") {
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

  clearError: () => set({ error: null }),
}))
