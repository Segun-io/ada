import { invoke } from "@tauri-apps/api/core"
import type {
  AdaProject,
  ProjectSummary,
  CreateProjectRequest,
  TerminalInfo,
  CreateTerminalRequest,
  ResizeTerminalRequest,
  BranchInfo,
  WorktreeInfo,
  ClientConfig,
  ClientSummary,
} from "./types"

export interface UpdateProjectSettingsRequest {
  project_id: string
  default_client: string | null
  auto_create_worktree: boolean
  worktree_base_path: string | null
}

// Project API
export const projectApi = {
  // Create a new project (creates directory, inits git, makes initial commit)
  create: (path: string): Promise<AdaProject> =>
    invoke("create_project", { request: { path } }),

  // Open an existing git repository as a project
  open: (path: string): Promise<AdaProject> =>
    invoke("open_project", { path }),

  list: (): Promise<ProjectSummary[]> =>
    invoke("list_projects"),

  get: (projectId: string): Promise<AdaProject> =>
    invoke("get_project", { projectId }),

  delete: (projectId: string): Promise<void> =>
    invoke("delete_project", { projectId }),

  updateSettings: (request: UpdateProjectSettingsRequest): Promise<AdaProject> =>
    invoke("update_project_settings", { request }),
}

// Terminal API
export const terminalApi = {
  create: (request: CreateTerminalRequest): Promise<TerminalInfo> =>
    invoke("create_terminal", { request }),

  list: (projectId: string): Promise<TerminalInfo[]> =>
    invoke("list_terminals", { projectId }),

  get: (terminalId: string): Promise<TerminalInfo> =>
    invoke("get_terminal", { terminalId }),

  write: (terminalId: string, data: string): Promise<void> =>
    invoke("write_terminal", { terminalId, data }),

  resize: (request: ResizeTerminalRequest): Promise<void> =>
    invoke("resize_terminal", { request }),

  close: (terminalId: string): Promise<void> =>
    invoke("close_terminal", { terminalId }),

  getHistory: (terminalId: string): Promise<string[]> =>
    invoke("get_terminal_history", { terminalId }),

  restart: (terminalId: string): Promise<TerminalInfo> =>
    invoke("restart_terminal", { terminalId }),

  markStopped: (terminalId: string): Promise<TerminalInfo> =>
    invoke("mark_terminal_stopped", { terminalId }),

  switchAgent: (terminalId: string, newClientId: string): Promise<TerminalInfo> =>
    invoke("switch_terminal_agent", { terminalId, newClientId }),
}

// Git API
export const gitApi = {
  getBranches: (projectId: string): Promise<BranchInfo[]> =>
    invoke("get_branches", { projectId }),

  getCurrentBranch: (projectId: string): Promise<string> =>
    invoke("get_current_branch", { projectId }),

  createWorktree: (
    projectId: string,
    branch: string,
    worktreePath?: string
  ): Promise<WorktreeInfo> =>
    invoke("create_worktree", { projectId, branch, worktreePath }),

  removeWorktree: (projectId: string, worktreePath: string): Promise<void> =>
    invoke("remove_worktree", { projectId, worktreePath }),

  listWorktrees: (projectId: string): Promise<WorktreeInfo[]> =>
    invoke("list_worktrees", { projectId }),
}

// Client API
export const clientApi = {
  list: (): Promise<ClientSummary[]> =>
    invoke("list_clients"),

  get: (clientId: string): Promise<ClientConfig> =>
    invoke("get_client", { clientId }),

  detectInstalled: (): Promise<ClientSummary[]> =>
    invoke("detect_installed_clients"),
}
