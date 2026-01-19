import { Home, FolderOpen, TreeDeciduous, Terminal, type LucideIcon } from "lucide-react"
import type { TerminalMode } from "@/lib/types"

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
