import { Home, FolderOpen, TreeDeciduous, Terminal, type LucideIcon } from "lucide-react"
import type { AgentActivity, TerminalMode } from "@/lib/types"

export interface ModeInfo {
  icon: LucideIcon
  color: string
  bgColor: string
  label: string
}

export function getModeInfo(mode: TerminalMode): ModeInfo {
  switch (mode) {
    case "main":
      return { icon: Home, color: "text-purple-400", bgColor: "bg-purple-500/20", label: "main" }
    case "folder":
      return { icon: FolderOpen, color: "text-orange-400", bgColor: "bg-orange-500/20", label: "folder" }
    case "current_branch":
      return { icon: Terminal, color: "text-green-400", bgColor: "bg-green-500/20", label: "main" }
    case "worktree":
      return { icon: TreeDeciduous, color: "text-blue-400", bgColor: "bg-blue-500/20", label: "worktree" }
    default:
      return { icon: Terminal, color: "text-muted-foreground", bgColor: "bg-muted", label: mode }
  }
}

export function getActivityBorderClass(activity: AgentActivity, status?: string): string {
  if (status === "stopped") return "border-yellow-500/50"
  switch (activity) {
    case "running":
      return "border-blue-500/50"
    case "waiting_for_user":
      return "border-orange-500 animate-pulse"
    case "done":
      return "border-green-500/50"
    case "idle":
    default:
      return "border-gray-500/50"
  }
}
