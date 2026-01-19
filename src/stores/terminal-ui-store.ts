import { create } from "zustand"

/**
 * Minimal UI state store for sidebar.
 * Terminal selection is managed by TanStack Router (URL search params)
 * Terminal output and activity are managed by TanStack Query (see lib/tauri-events.ts)
 */
interface TerminalUIState {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useTerminalUIStore = create<TerminalUIState>((set) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}))

// Selector hooks for minimal re-renders
export const useSidebarCollapsed = () =>
  useTerminalUIStore((state) => state.sidebarCollapsed)
