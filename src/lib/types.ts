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
}

export interface ProjectSettings {
  default_client: string | null
  auto_create_worktree: boolean
  worktree_base_path: string | null
}

export interface ProjectSummary {
  id: string
  name: string
  path: string
  terminal_count: number
  created_at: string
  updated_at: string
}

export interface CreateProjectRequest {
  path: string
}

// Terminal types
export type TerminalStatus = "starting" | "running" | "stopped" | "error"
export type AgentActivity = "idle" | "active" | "thinking"

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
}

// Extended terminal info with frontend-tracked activity
export interface TerminalWithActivity extends TerminalInfo {
  activity: AgentActivity
  lastActivityAt: number
}

export interface CreateTerminalRequest {
  project_id: string
  name: string
  client_id: string
  branch: string | null
  use_worktree: boolean
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
