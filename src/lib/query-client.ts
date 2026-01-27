import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false, // Tauri app, not a browser tab
      retry: 1,
    },
  },
})

// Query keys factory for type-safe and consistent keys
export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    list: () => [...queryKeys.projects.all, "list"] as const,
    detail: (id: string) => [...queryKeys.projects.all, "detail", id] as const,
  },
  terminals: {
    all: ["terminals"] as const,
    list: (projectId: string) => [...queryKeys.terminals.all, "list", projectId] as const,
    detail: (id: string) => [...queryKeys.terminals.all, "detail", id] as const,
    history: (id: string) => [...queryKeys.terminals.all, "history", id] as const,
  },
  agents: {
    all: ["agents"] as const,
    status: (terminalId: string) => [...queryKeys.agents.all, "status", terminalId] as const,
  },
  runtime: {
    all: ["runtime"] as const,
    config: () => [...queryKeys.runtime.all, "config"] as const,
  },
  clients: {
    all: ["clients"] as const,
    list: () => [...queryKeys.clients.all, "list"] as const,
    detail: (id: string) => [...queryKeys.clients.all, "detail", id] as const,
  },
  git: {
    all: (projectId: string) => ["git", projectId] as const,
    branches: (projectId: string) => [...queryKeys.git.all(projectId), "branches"] as const,
    currentBranch: (projectId: string) => [...queryKeys.git.all(projectId), "currentBranch"] as const,
    worktrees: (projectId: string) => [...queryKeys.git.all(projectId), "worktrees"] as const,
  },
}
