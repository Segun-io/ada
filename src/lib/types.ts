// Project types
export interface AdaProject {
  id: string
  name: string
  path: string
  description: string | null
  created_at: string
  updated_at: string
  terminal_ids: string[]
  settings: ProjectSettings
  main_terminal_id: string | null
  is_git_repo: boolean
}

export interface ProjectSettings {
  default_client: string | null
  auto_create_worktree: boolean
  worktree_base_path: string | null
  last_visited_terminal_id: string | null
}

export interface ProjectSummary {
  id: string
  name: string
  path: string
  terminal_count: number
  created_at: string
  updated_at: string
  main_terminal_id: string | null
  is_git_repo: boolean
}

export interface CreateProjectRequest {
  path: string
  init_git: boolean
}

// Terminal types
export type TerminalStatus = "starting" | "running" | "stopped" | "error"
export type TerminalMode = "main" | "folder" | "current_branch" | "worktree"
export type AgentStatus = "idle" | "working" | "permission" | "review"

export interface CommandSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface TerminalInfo {
  id: string
  project_id: string
  name: string
  client_id: string
  working_dir: string
  branch: string | null
  worktree_path: string | null
  status: TerminalStatus
  created_at: string
  command: CommandSpec
  shell: string | null
  agent_status: AgentStatus
  mode: TerminalMode
  is_main: boolean
  folder_path: string | null
}

export interface CreateTerminalRequest {
  project_id: string
  name: string
  client_id: string
  mode: TerminalMode
  folder_path: string | null
  worktree_branch: string | null
}

export interface TerminalOutput {
  terminal_id: string
  data: string
}

export interface ResizeTerminalRequest {
  terminal_id: string
  cols: number
  rows: number
}

// Git types
export interface BranchInfo {
  name: string
  is_current: boolean
  is_remote: boolean
  upstream: string | null
}

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  is_bare: boolean
}

// Client types
export type ClientType = "claude_code" | "open_code" | "codex" | "custom"

export interface ClientConfig {
  id: string
  name: string
  client_type: ClientType
  command: string
  args: string[]
  env: Record<string, string>
  description: string
  installed: boolean
}

export interface ClientSummary {
  id: string
  name: string
  client_type: ClientType
  description: string
  installed: boolean
}

// Runtime config
export interface RuntimeConfig {
  ada_home: string
  data_dir: string
  daemon_port: number
  notification_port: number
  shell_override: string | null
}

// Daemon types
export type ConnectionState = "connected" | "disconnected" | "notRunning" | "connecting"

export interface DaemonStatusInfo {
  running: boolean
  connected: boolean
  pid: number | null
  port: number | null
  uptimeSecs: number | null
  sessionCount: number | null
  version: string | null
}

// CLI installation types
export interface CliInstallStatus {
  installed: boolean
  installPath: string | null
  bundledPath: string | null
  upToDate: boolean
  /** Whether installation is available (false in dev mode unless ADA_ALLOW_DEV_INSTALL=1) */
  canInstall: boolean
}
