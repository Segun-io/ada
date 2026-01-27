// Project query options & mutations
export {
  projectsQueryOptions,
  projectQueryOptions,
  useCreateProject,
  useOpenProject,
  useDeleteProject,
  useUpdateProjectSettings,
} from "./projects"

// Terminal query options & mutations
export {
  terminalsQueryOptions,
  terminalQueryOptions,
  terminalHistoryQueryOptions,
  useCreateTerminal,
  useCreateMainTerminal,
  useCloseTerminal,
  useRestartTerminal,
  useReconnectTerminal,
  useMarkTerminalStopped,
  useSwitchTerminalAgent,
  useWriteTerminal,
  useResizeTerminal,
} from "./terminals"

// Client query options
export {
  clientsQueryOptions,
  clientQueryOptions,
} from "./clients"

// Git query options & mutations
export {
  branchesQueryOptions,
  currentBranchQueryOptions,
  worktreesQueryOptions,
  useCreateWorktree,
  useRemoveWorktree,
} from "./git"

// Runtime query options & mutations
export {
  runtimeConfigQueryOptions,
  useSetShellOverride,
} from "./runtime"
