import { Plus, X, RotateCcw, Loader2, Home, FolderOpen, GitBranch, TreeDeciduous } from "lucide-react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TerminalInfo, ClientSummary, AgentActivity, TerminalMode } from "@/lib/types"

interface TerminalStripProps {
  terminals: TerminalInfo[]
  clients: ClientSummary[]
  activeTerminalId: string | null
  getActivity: (terminalId: string) => AgentActivity
  onSelectTerminal: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
  onRestartTerminal: (terminalId: string) => void
  onNewTerminal: () => void
}

export function TerminalStrip({
  terminals,
  clients,
  activeTerminalId,
  getActivity,
  onSelectTerminal,
  onCloseTerminal,
  onRestartTerminal,
  onNewTerminal,
}: TerminalStripProps) {
  const getClientName = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId)
    return client?.name || clientId
  }

  return (
    <div className="h-44 border-t border-border bg-background flex-shrink-0">
      <ScrollArea className="h-full">
        <div className="flex gap-3 p-3 h-full">
          {terminals.map((terminal) => (
            <TerminalCard
              key={terminal.id}
              terminal={terminal}
              clientName={getClientName(terminal.client_id)}
              activity={getActivity(terminal.id)}
              isActive={terminal.id === activeTerminalId}
              onSelect={() => onSelectTerminal(terminal.id)}
              onClose={() => onCloseTerminal(terminal.id)}
              onRestart={() => onRestartTerminal(terminal.id)}
            />
          ))}

          {/* New Terminal Card */}
          <button
            onClick={onNewTerminal}
            className="flex-shrink-0 w-40 h-36 rounded-xl border-2 border-dashed border-border hover:border-muted-foreground/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-6 w-6" />
            <span className="text-xs">New Terminal</span>
          </button>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}

interface TerminalCardProps {
  terminal: TerminalInfo
  clientName: string
  activity: AgentActivity
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onRestart: () => void
}

// Get mode display info
const getModeInfo = (mode: TerminalMode) => {
  switch (mode) {
    case "main":
      return { icon: Home, color: "text-purple-400", bgColor: "bg-purple-500/20", label: "main" }
    case "folder":
      return { icon: FolderOpen, color: "text-orange-400", bgColor: "bg-orange-500/20", label: "folder" }
    case "current_branch":
      return { icon: GitBranch, color: "text-green-400", bgColor: "bg-green-500/20", label: "branch" }
    case "worktree":
      return { icon: TreeDeciduous, color: "text-blue-400", bgColor: "bg-blue-500/20", label: "worktree" }
    default:
      return { icon: GitBranch, color: "text-muted-foreground", bgColor: "bg-muted", label: mode }
  }
}

function TerminalCard({
  terminal,
  clientName,
  activity,
  isActive,
  onSelect,
  onClose,
  onRestart,
}: TerminalCardProps) {
  const isStopped = terminal.status === "stopped"
  const isRunning = terminal.status === "running"
  const modeInfo = getModeInfo(terminal.mode)
  const ModeIcon = modeInfo.icon

  // Terminal status color (for the terminal itself)
  const getTerminalStatusColor = () => {
    if (isStopped) return "border-yellow-500/50"
    if (isRunning) return "border-green-500/30"
    return "border-border"
  }

  // Agent activity indicator color
  const getActivityColor = () => {
    if (isStopped) return "bg-yellow-500"
    if (activity === "thinking") return "bg-blue-500"
    if (activity === "active") return "bg-green-500"
    return "bg-gray-500" // idle
  }

  // Activity indicator animation
  const getActivityAnimation = () => {
    if (isStopped) return ""
    if (activity === "thinking") return "animate-pulse"
    if (activity === "active") return "animate-pulse"
    return ""
  }

  // Card border color based on status/activity
  const getCardBorderClass = () => {
    if (isStopped) return "ring-1 ring-yellow-500/50"
    if (activity === "thinking") return "ring-1 ring-blue-500/50 animate-pulse"
    if (activity === "active") return "ring-1 ring-green-500/50"
    return ""
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex-shrink-0 w-40 h-36 cursor-pointer transition-all rounded-xl",
        getCardBorderClass(),
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {/* Close Button - hidden for main terminal */}
      {!terminal.is_main && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity z-10"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      )}

      {/* Mini Terminal Preview */}
      <div className={cn(
        "h-20 rounded-xl bg-[#1a1a1a] border-2 flex items-center justify-center mb-2 overflow-hidden relative transition-colors",
        getTerminalStatusColor(),
        isStopped && "opacity-60"
      )}>
        {/* Mode indicator badge in top-left */}
        <div className={cn(
          "absolute top-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium",
          modeInfo.bgColor,
          modeInfo.color
        )}>
          <ModeIcon className="h-2.5 w-2.5" />
          {modeInfo.label}
        </div>

        {/* Activity indicator in thumbnail */}
        {isRunning && activity === "thinking" && (
          <Loader2 className="h-6 w-6 text-blue-400 animate-spin" />
        )}
        {isRunning && activity === "active" && (
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        {isRunning && activity === "idle" && (
          <div className="text-[8px] text-muted-foreground font-mono opacity-50 p-2 text-center">
            idle
          </div>
        )}
        {isStopped && (
          <div className="text-[8px] text-yellow-500 font-mono p-2 text-center">
            stopped
          </div>
        )}

        {/* Restart overlay for stopped terminals */}
        {isStopped && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation()
                onRestart()
              }}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Restart
            </Button>
          </div>
        )}
      </div>

      {/* Terminal Info */}
      <div className="space-y-0.5 px-1">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium truncate flex-1">{terminal.name}</p>
          {/* Terminal status indicator */}
          <span className={cn(
            "h-1.5 w-1.5 rounded-full flex-shrink-0",
            isStopped ? "bg-yellow-500" : "bg-green-500"
          )} />
          {/* Agent activity indicator */}
          {isRunning && (
            <span className={cn(
              "h-2 w-2 rounded-full flex-shrink-0",
              getActivityColor(),
              getActivityAnimation()
            )} />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">
          {terminal.mode === "folder"
            ? terminal.folder_path || "root"
            : terminal.branch || "main"}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">{clientName}</p>
      </div>
    </div>
  )
}
