import { useState } from "react"
import { Plus, X, RotateCcw, Loader2, Home, FolderOpen, GitBranch, TreeDeciduous, Bot, Terminal } from "lucide-react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { cn } from "@/lib/utils"
import type { TerminalInfo, ClientSummary, AgentActivity, TerminalMode } from "@/lib/types"

// Get border color based on activity (matching terminal-view.tsx)
const getActivityBorderClass = (activity: AgentActivity, status?: string) => {
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

interface TerminalStripProps {
  terminals: TerminalInfo[]
  clients: ClientSummary[]
  activeTerminalId: string | null
  mainTerminal: TerminalInfo | null
  defaultClientId: string | null
  isMainTerminalActive: boolean
  getActivity: (terminalId: string) => AgentActivity
  onSelectTerminal: (terminalId: string) => void
  onSelectMainTerminal: () => void
  onCloseTerminal: (terminalId: string) => void
  onRestartTerminal: (terminalId: string) => void
  onNewTerminal: () => void
  onSelectDefaultClient: (clientId: string) => void
}

// Get activity indicator content
const getActivityIndicator = (activity: AgentActivity, isStopped: boolean) => {
  if (isStopped) {
    return <span className="text-[8px] text-yellow-500 font-mono">stopped</span>
  }
  switch (activity) {
    case "running":
      return (
        <div className="flex items-center gap-0.5">
          <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      )
    case "waiting_for_user":
      return <Loader2 className="h-4 w-4 text-orange-400 animate-spin" />
    case "done":
      return <span className="text-[8px] text-green-500 font-mono">done</span>
    case "idle":
    default:
      return <span className="text-[8px] text-muted-foreground font-mono opacity-50">idle</span>
  }
}

export function TerminalStrip({
  terminals,
  clients,
  activeTerminalId,
  mainTerminal,
  defaultClientId,
  isMainTerminalActive,
  getActivity,
  onSelectTerminal,
  onSelectMainTerminal,
  onCloseTerminal,
  onRestartTerminal,
  onNewTerminal,
  onSelectDefaultClient,
}: TerminalStripProps) {
  const [closeConfirmation, setCloseConfirmation] = useState<{ open: boolean; terminalId: string; terminalName: string }>({
    open: false,
    terminalId: "",
    terminalName: "",
  })

  const installedClients = clients.filter((c) => c.installed)

  // Filter out main terminal from regular terminals list
  const otherTerminals = terminals.filter((t) => !t.is_main)

  const handleCloseClick = (terminal: TerminalInfo, shiftKey: boolean) => {
    if (shiftKey) {
      onCloseTerminal(terminal.id)
    } else {
      setCloseConfirmation({
        open: true,
        terminalId: terminal.id,
        terminalName: terminal.name,
      })
    }
  }

  const confirmClose = () => {
    onCloseTerminal(closeConfirmation.terminalId)
    setCloseConfirmation({ open: false, terminalId: "", terminalName: "" })
  }

  const cancelClose = () => {
    setCloseConfirmation({ open: false, terminalId: "", terminalName: "" })
  }

  return (
    <div className="h-36 border-t border-border bg-background flex-shrink-0">
      <ScrollArea className="h-full">
        <div className="flex gap-3 p-3 h-full">
          {/* Static Main Terminal Card - Always First */}
          <MainTerminalCard
            mainTerminal={mainTerminal}
            defaultClientId={defaultClientId}
            installedClients={installedClients}
            activity={mainTerminal ? getActivity(mainTerminal.id) : "idle"}
            isActive={isMainTerminalActive}
            onSelect={onSelectMainTerminal}
            onRestart={mainTerminal ? () => onRestartTerminal(mainTerminal.id) : undefined}
            onSelectClient={onSelectDefaultClient}
          />

          {/* Other Terminals */}
          {otherTerminals.map((terminal) => (
            <TerminalCard
              key={terminal.id}
              terminal={terminal}
              activity={getActivity(terminal.id)}
              isActive={terminal.id === activeTerminalId}
              onSelect={() => onSelectTerminal(terminal.id)}
              onClose={(shiftKey) => handleCloseClick(terminal, shiftKey)}
              onRestart={() => onRestartTerminal(terminal.id)}
            />
          ))}

          {/* New Terminal Card */}
          <button
            onClick={onNewTerminal}
            className="flex-shrink-0 w-36 h-28 rounded-xl border-2 border-dashed border-border hover:border-muted-foreground/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs">New Terminal</span>
          </button>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Close Confirmation Dialog */}
      <ConfirmationDialog
        open={closeConfirmation.open}
        title="Close Terminal"
        description={`Are you sure you want to close "${closeConfirmation.terminalName}"? The agent process will be terminated.`}
        confirmText="Close"
        variant="destructive"
        onConfirm={confirmClose}
        onCancel={cancelClose}
      />
    </div>
  )
}

interface MainTerminalCardProps {
  mainTerminal: TerminalInfo | null
  defaultClientId: string | null
  installedClients: ClientSummary[]
  activity: AgentActivity
  isActive: boolean
  onSelect: () => void
  onRestart?: () => void
  onSelectClient: (clientId: string) => void
}

function MainTerminalCard({
  mainTerminal,
  defaultClientId,
  installedClients,
  activity,
  isActive,
  onSelect,
  onRestart,
  onSelectClient,
}: MainTerminalCardProps) {
  const hasAgent = !!defaultClientId
  const isStopped = mainTerminal?.status === "stopped"

  // If no agent selected, show selection state
  if (!hasAgent) {
    return (
      <div
        className={cn(
          "group relative flex-shrink-0 w-36 h-28 rounded-xl transition-all",
          isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        {/* Mini Terminal Preview - Select Agent State */}
        <div className="h-16 rounded-xl bg-[#1a1a1a] border-2 border-dashed border-purple-500/30 flex flex-col items-center justify-center mb-1.5 overflow-hidden relative">
          {/* Mode indicator badge */}
          <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-purple-500/20 text-purple-400">
            <Home className="h-2 w-2" />
            main
          </div>

          <Bot className="h-4 w-4 text-muted-foreground mb-0.5" />
          <span className="text-[8px] text-muted-foreground">Select Agent</span>
        </div>

        {/* Agent Selector */}
        <div className="px-1">
          <Select onValueChange={onSelectClient}>
            <SelectTrigger className="h-5 text-[9px]">
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent>
              {installedClients.map((client) => (
                <SelectItem key={client.id} value={client.id} className="text-xs">
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  // Agent is selected - show terminal state
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex-shrink-0 w-36 h-28 cursor-pointer transition-all rounded-xl",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {/* Mini Terminal Preview with integrated content */}
      <div className={cn(
        "h-full rounded-xl bg-[#1a1a1a] border-2 flex flex-col overflow-hidden relative transition-colors",
        getActivityBorderClass(activity, mainTerminal?.status),
        isStopped && "opacity-70"
      )}>
        {/* Mode indicator badge - top left */}
        <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-purple-500/20 text-purple-400">
          <Home className="h-2 w-2" />
          main
        </div>

        {/* Activity indicator - center */}
        <div className="flex-1 flex items-center justify-center">
          {getActivityIndicator(activity, isStopped)}
        </div>

        {/* Name overlay - bottom with gradient */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <p className="text-[10px] font-medium text-white truncate">Main Terminal</p>
        </div>

        {/* Restart overlay for stopped terminals */}
        {isStopped && onRestart && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="secondary"
              size="sm"
              className="h-6 text-[10px]"
              onClick={(e) => {
                e.stopPropagation()
                onRestart()
              }}
            >
              <RotateCcw className="h-2.5 w-2.5 mr-1" />
              Restart
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

interface TerminalCardProps {
  terminal: TerminalInfo
  activity: AgentActivity
  isActive: boolean
  onSelect: () => void
  onClose: (shiftKey: boolean) => void
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
      return { icon: Terminal, color: "text-green-400", bgColor: "bg-green-500/20", label: "main" }
    case "worktree":
      return { icon: TreeDeciduous, color: "text-blue-400", bgColor: "bg-blue-500/20", label: "worktree" }
    default:
      return { icon: GitBranch, color: "text-muted-foreground", bgColor: "bg-muted", label: mode }
  }
}

function TerminalCard({
  terminal,
  activity,
  isActive,
  onSelect,
  onClose,
  onRestart,
}: TerminalCardProps) {
  const isStopped = terminal.status === "stopped"
  const modeInfo = getModeInfo(terminal.mode)
  const ModeIcon = modeInfo.icon

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex-shrink-0 w-36 h-28 cursor-pointer transition-all rounded-xl",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {/* Close Button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={(e) => {
          e.stopPropagation()
          onClose(e.shiftKey)
        }}
        title="Close terminal (Shift+click to skip confirmation)"
      >
        <X className="h-3 w-3" />
      </Button>

      {/* Mini Terminal Preview with integrated content */}
      <div className={cn(
        "h-full rounded-xl bg-[#1a1a1a] border-2 flex flex-col overflow-hidden relative transition-colors",
        getActivityBorderClass(activity, terminal.status),
        isStopped && "opacity-70"
      )}>
        {/* Mode indicator badge - top left */}
        <div className={cn(
          "absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium",
          modeInfo.bgColor,
          modeInfo.color
        )}>
          <ModeIcon className="h-2 w-2" />
          {modeInfo.label}
        </div>

        {/* Activity indicator - center */}
        <div className="flex-1 flex items-center justify-center">
          {getActivityIndicator(activity, isStopped)}
        </div>

        {/* Name overlay - bottom with gradient */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <p className="text-[10px] font-medium text-white truncate">{terminal.name}</p>
        </div>

        {/* Restart overlay for stopped terminals */}
        {isStopped && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="secondary"
              size="sm"
              className="h-6 text-[10px]"
              onClick={(e) => {
                e.stopPropagation()
                onRestart()
              }}
            >
              <RotateCcw className="h-2.5 w-2.5 mr-1" />
              Restart
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
