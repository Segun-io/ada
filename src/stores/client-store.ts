import { create } from "zustand"
import type { ClientSummary } from "@/lib/types"
import { clientApi } from "@/lib/api"

interface ClientState {
  clients: ClientSummary[]
  isLoading: boolean
  error: string | null

  // Actions
  loadClients: () => Promise<void>
  detectInstalledClients: () => Promise<void>
  clearError: () => void
}

export const useClientStore = create<ClientState>((set) => ({
  clients: [],
  isLoading: false,
  error: null,

  loadClients: async () => {
    set({ isLoading: true, error: null })
    try {
      const clients = await clientApi.list()
      set({ clients, isLoading: false })
    } catch (error) {
      set({ error: String(error), isLoading: false })
    }
  },

  detectInstalledClients: async () => {
    set({ isLoading: true, error: null })
    try {
      const clients = await clientApi.detectInstalled()
      set({ clients, isLoading: false })
    } catch (error) {
      set({ error: String(error), isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
