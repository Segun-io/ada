import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { AgentStatus, TerminalInfo, ClientConfig } from "./types";
import { queryKeys } from "./query-client";
import { terminalApi } from "./api";

// =============================================================================
// Event Types from Tauri Backend
// =============================================================================

interface TerminalOutputEvent {
  terminal_id: string;
  data: string;
}

interface TerminalStatusEvent {
  terminal_id: string;
  project_id: string;
  status: "running" | "stopped";
}

interface AgentStatusEvent {
  terminal_id: string;
  status: AgentStatus;
}

interface HookEvent {
  terminal_id: string;
  project_id: string | null;
  agent: string;
  event: string;
  payload: string | null;
}

// =============================================================================
// Query Keys for Event-Driven Data
// =============================================================================

export const eventQueryKeys = {
  terminalOutput: (terminalId: string) =>
    ["terminals", "output", terminalId] as const,
};

// =============================================================================
// Event Handlers
// =============================================================================

// Batch terminal output to avoid excessive re-renders
const outputBuffers = new Map<string, string[]>();
let flushScheduled = false;

function flushOutputBuffers(queryClient: QueryClient) {
  flushScheduled = false;

  for (const [terminal_id, chunks] of outputBuffers) {
    if (chunks.length === 0) continue;

    // Batch append all chunks at once
    queryClient.setQueryData<string[]>(
      eventQueryKeys.terminalOutput(terminal_id),
      (oldData = []) => [...oldData, ...chunks],
    );
  }

  outputBuffers.clear();
}

function handleTerminalOutput(
  queryClient: QueryClient,
  event: TerminalOutputEvent,
) {
  const { terminal_id, data } = event;

  // Buffer the output chunk
  const buffer = outputBuffers.get(terminal_id) ?? [];
  buffer.push(data);
  outputBuffers.set(terminal_id, buffer);

  // Schedule a flush on next animation frame (batches rapid events)
  if (!flushScheduled) {
    flushScheduled = true;
    requestAnimationFrame(() => flushOutputBuffers(queryClient));
  }
}

function handleTerminalStatus(
  queryClient: QueryClient,
  event: TerminalStatusEvent,
) {
  const { terminal_id, project_id, status } = event;

  console.log(
    `%c[TERMINAL STATUS]%c ${status}`,
    "background: #2563eb; color: white; padding: 2px 6px; border-radius: 3px;",
    status === "running" ? "color: #22c55e; font-weight: bold;" : "color: #eab308; font-weight: bold;",
  );
  console.log("  terminal_id:", terminal_id);
  console.log("  project_id:", project_id);
  console.log("  status:", status);
  console.log("  timestamp:", new Date().toISOString());

  // Update the terminal in the terminals list cache
  queryClient.setQueryData<TerminalInfo[]>(
    queryKeys.terminals.list(project_id),
    (oldData) => {
      if (!oldData) return oldData;
      return oldData.map((t) => (t.id === terminal_id ? { ...t, status } : t));
    },
  );

  // Also update the individual terminal detail if cached
  queryClient.setQueryData<TerminalInfo>(
    queryKeys.terminals.detail(terminal_id),
    (oldData) => {
      if (!oldData) return oldData;
      return { ...oldData, status };
    },
  );
}

function handleAgentStatus(queryClient: QueryClient, event: AgentStatusEvent) {
  const { terminal_id, status } = event;

  const statusColors: Record<AgentStatus, string> = {
    idle: "color: #6b7280;",
    working: "color: #22c55e;",
    permission: "color: #f59e0b;",
    review: "color: #ef4444;",
  };

  console.log(
    `%c[AGENT STATUS]%c ${status}`,
    "background: #7c3aed; color: white; padding: 2px 6px; border-radius: 3px;",
    statusColors[status] + " font-weight: bold;",
  );
  console.log("  terminal_id:", terminal_id);
  console.log("  status:", status);
  console.log("  timestamp:", new Date().toISOString());

  queryClient.setQueryData(queryKeys.agents.status(terminal_id), status);

  queryClient.setQueryData<TerminalInfo>(
    queryKeys.terminals.detail(terminal_id),
    (oldData) => {
      if (!oldData) return oldData;
      return { ...oldData, agent_status: status };
    },
  );

  const listQueries = queryClient.getQueriesData<TerminalInfo[]>({
    queryKey: ["terminals", "list"],
  });
  for (const [key, data] of listQueries) {
    if (!data) continue;
    const updated = data.map((t) =>
      t.id === terminal_id ? { ...t, agent_status: status } : t,
    );
    queryClient.setQueryData(key, updated);
  }
}

function handleTerminalClosed(queryClient: QueryClient, terminalId: string) {
  console.log(
    `%c[TERMINAL CLOSED]%c`,
    "background: #dc2626; color: white; padding: 2px 6px; border-radius: 3px;",
    "",
  );
  console.log("  terminal_id:", terminalId);
  console.log("  timestamp:", new Date().toISOString());

  // Invalidate terminal queries to refresh status
  queryClient.invalidateQueries({
    queryKey: queryKeys.terminals.detail(terminalId),
  });
}

function handleHookEvent(queryClient: QueryClient, event: HookEvent) {
  const agentColors: Record<string, string> = {
    claude: "background: #d97706;",
    codex: "background: #059669;",
    opencode: "background: #7c3aed;",
    gemini: "background: #2563eb;",
    cursor: "background: #dc2626;",
    unknown: "background: #6b7280;",
  };

  // Look up project name from cache
  let projectName = event.project_id || "unknown";
  if (event.project_id) {
    const projectData = queryClient.getQueryData<{ name: string }>(
      queryKeys.projects.detail(event.project_id)
    );
    if (projectData?.name) {
      projectName = projectData.name;
    }
  }

  // Look up terminal name from cache
  let terminalName = "unknown";
  const terminalData = queryClient.getQueryData<TerminalInfo>(
    queryKeys.terminals.detail(event.terminal_id)
  );
  if (terminalData?.name) {
    terminalName = terminalData.name;
  } else if (event.project_id) {
    // Try to find in project's terminal list
    const terminals = queryClient.getQueryData<TerminalInfo[]>(
      queryKeys.terminals.list(event.project_id)
    );
    const terminal = terminals?.find((t) => t.id === event.terminal_id);
    if (terminal?.name) {
      terminalName = terminal.name;
    }
  }

  // Look up client display name from cache
  let agentDisplayName = event.agent;
  const clients = queryClient.getQueryData<ClientConfig[]>(queryKeys.clients.list());
  const client = clients?.find((c) => c.id === event.agent || c.name.toLowerCase().includes(event.agent));
  if (client?.name) {
    agentDisplayName = client.name;
  }

  const bgColor = agentColors[event.agent] || agentColors.unknown;

  console.log(
    `%c[HOOK ${event.agent.toUpperCase()}]%c ${event.event}`,
    `${bgColor} color: white; padding: 2px 6px; border-radius: 3px;`,
    "color: #a78bfa; font-weight: bold;",
  );
  console.log("  project:", projectName);
  console.log("  terminal:", terminalName);
  console.log("  agent:", agentDisplayName);
  console.log("  event:", event.event);
  if (event.payload) {
    try {
      const parsed = JSON.parse(event.payload);
      console.log("  payload:", parsed);
    } catch {
      console.log("  payload:", event.payload);
    }
  }
  console.log("  timestamp:", new Date().toISOString());
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
    const unlisteners: Promise<UnlistenFn>[] = [];

    // Terminal output events
    unlisteners.push(
      listen<TerminalOutputEvent>("terminal-output", (event) => {
        handleTerminalOutput(queryClient, event.payload);
      }),
    );

    // Terminal closed events (backward compatibility - just sends ID)
    unlisteners.push(
      listen<string>("terminal-closed", (event) => {
        handleTerminalClosed(queryClient, event.payload);
      }),
    );

    // Terminal status events (if backend sends them)
    unlisteners.push(
      listen<TerminalStatusEvent>("terminal-status", (event) => {
        handleTerminalStatus(queryClient, event.payload);
      }),
    );

    // Agent status events
    unlisteners.push(
      listen<AgentStatusEvent>("agent-status-change", (event) => {
        handleAgentStatus(queryClient, event.payload);
      }),
    );

    // Raw hook events (for logging/debugging all agent events)
    unlisteners.push(
      listen<HookEvent>("hook-event", (event) => {
        handleHookEvent(queryClient, event.payload);
      }),
    );

    // Cleanup on unmount
    return () => {
      unlisteners.forEach((unlisten) => {
        unlisten.then((fn) => fn());
      });
    };
  }, [queryClient]);
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
  });

  return data;
}

// =============================================================================
// Utility Functions for Direct Cache Access
// =============================================================================

/**
 * Clear terminal output from cache (e.g., when switching agents)
 */
export function clearTerminalOutput(
  queryClient: QueryClient,
  terminalId: string,
) {
  queryClient.setQueryData(eventQueryKeys.terminalOutput(terminalId), []);
}

/**
 * Remove terminal data from cache when terminal is closed
 */
export function removeTerminalFromCache(
  queryClient: QueryClient,
  terminalId: string,
) {
  queryClient.removeQueries({
    queryKey: eventQueryKeys.terminalOutput(terminalId),
  });
}

/**
 * Load terminal history into the output cache (for imperative use)
 */
export function loadTerminalHistory(
  queryClient: QueryClient,
  terminalId: string,
  history: string[],
) {
  queryClient.setQueryData(eventQueryKeys.terminalOutput(terminalId), history);
}
