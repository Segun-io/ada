import { useState, useCallback, memo } from "react"
import { Plus, X, RotateCcw, Home, Bot, Circle } from "lucide-react"
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
import { getModeInfo } from "@/lib/terminal-utils"
import { useTerminalHasUnseen } from "@/lib/tauri-events"
import type { TerminalInfo, ClientSummary, TerminalStatus } from "@/lib/types"

// Get border class based on unseen state and status
const getStatusBorderClass = (hasUnseen: boolean, status?: TerminalStatus): string => {
  if (status === "stopped") return "border-yellow-500/50"
  if (hasUnseen) return "border-orange-500 animate-pulse shadow-[0_0_12px_rgba(249,115,22,0.6)]"
  if (status === "running") return "border-green-500/50"
  return "border-gray-600/50"
}

// Get status indicator content
const getStatusIndicator = (hasUnseen: boolean, isStopped: boolean) => {
  if (isStopped) {
    return <span className="text-[8px] text-yellow-500 font-mono">stopped</span>
  }
  if (hasUnseen) {
    return (
      <div className="flex items-center gap-1">
        <Circle className="h-2 w-2 fill-orange-400 text-orange-400 animate-pulse" />
        <span className="text-[8px] text-orange-400 font-mono">new output</span>
      </div>
    )
  }
  return <span className="text-[8px] text-muted-foreground font-mono opacity-50">ready</span>
}

interface TerminalStripProps {
  terminals: TerminalInfo[]
  clients: ClientSummary[]
  mainTerminal: TerminalInfo | null
  activeTerminalId: string | null
  defaultClientId: string | null
  onSelectTerminal: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
  onRestartTerminal: (terminalId: string) => void
  onNewTerminal: () => void
  onSelectDefaultClient: (clientId: string) => void
}

export function TerminalStrip({
  terminals,
  clients,
  mainTerminal,
  activeTerminalId,
  defaultClientId,
  onSelectTerminal,
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
  const otherTerminals = terminals.filter((t) => !t.is_main)
  const isMainTerminalActive = mainTerminal ? activeTerminalId === mainTerminal.id : false

  const handleCloseClick = useCallback((terminal: TerminalInfo, shiftKey: boolean) => {
    if (shiftKey) {
      onCloseTerminal(terminal.id)
    } else {
      setCloseConfirmation({
        open: true,
        terminalId: terminal.id,
        terminalName: terminal.name,
      })
    }
  }, [onCloseTerminal])

  const confirmClose = useCallback(() => {
    onCloseTerminal(closeConfirmation.terminalId)
    setCloseConfirmation({ open: false, terminalId: "", terminalName: "" })
  }, [closeConfirmation.terminalId, onCloseTerminal])

  const cancelClose = useCallback(() => {
    setCloseConfirmation({ open: false, terminalId: "", terminalName: "" })
  }, [])

  return (
    <div className="h-36 border-t border-border bg-background flex-shrink-0">
      <ScrollArea className="h-full">
        <div className="flex gap-3 p-3 h-full">
          {/* Static Main Terminal Card - Always First */}
          <MainTerminalCardWrapper
            mainTerminal={mainTerminal}
            defaultClientId={defaultClientId}
            installedClients={installedClients}
            isActive={isMainTerminalActive}
            onSelect={onSelectTerminal}
            onRestart={onRestartTerminal}
            onSelectClient={onSelectDefaultClient}
          />

          {/* Other Terminals */}
          {otherTerminals.map((terminal) => (
            <TerminalCardWrapper
              key={terminal.id}
              terminal={terminal}
              isActive={terminal.id === activeTerminalId}
              onSelect={onSelectTerminal}
              onClose={handleCloseClick}
              onRestart={onRestartTerminal}
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

// =============================================================================
// Wrapper Components with Activity Tracking
// =============================================================================

interface MainTerminalCardWrapperProps {
  mainTerminal: TerminalInfo | null
  defaultClientId: string | null
  installedClients: ClientSummary[]
  isActive: boolean
  onSelect: (terminalId: string) => void
  onRestart: (terminalId: string) => void
  onSelectClient: (clientId: string) => void
}

function MainTerminalCardWrapper({
  mainTerminal,
  defaultClientId,
  installedClients,
  isActive,
  onSelect,
  onRestart,
  onSelectClient,
}: MainTerminalCardWrapperProps) {
  // Check if this terminal has unseen output
  const hasUnseen = useTerminalHasUnseen(mainTerminal?.id ?? "")

  const handleSelect = useCallback(() => {
    if (mainTerminal) {
      onSelect(mainTerminal.id)
    }
  }, [mainTerminal, onSelect])

  const handleRestart = useCallback(() => {
    if (mainTerminal) {
      onRestart(mainTerminal.id)
    }
  }, [mainTerminal, onRestart])

  return (
    <MainTerminalCard
      mainTerminal={mainTerminal}
      defaultClientId={defaultClientId}
      installedClients={installedClients}
      hasUnseen={hasUnseen && !isActive}
      isActive={isActive}
      onSelect={handleSelect}
      onRestart={mainTerminal ? handleRestart : undefined}
      onSelectClient={onSelectClient}
    />
  )
}

interface TerminalCardWrapperProps {
  terminal: TerminalInfo
  isActive: boolean
  onSelect: (terminalId: string) => void
  onClose: (terminal: TerminalInfo, shiftKey: boolean) => void
  onRestart: (terminalId: string) => void
}

function TerminalCardWrapper({
  terminal,
  isActive,
  onSelect,
  onClose,
  onRestart,
}: TerminalCardWrapperProps) {
  // Check if this terminal has unseen output
  const hasUnseen = useTerminalHasUnseen(terminal.id)

  const handleSelect = useCallback(() => {
    onSelect(terminal.id)
  }, [terminal.id, onSelect])

  const handleClose = useCallback((shiftKey: boolean) => {
    onClose(terminal, shiftKey)
  }, [terminal, onClose])

  const handleRestart = useCallback(() => {
    onRestart(terminal.id)
  }, [terminal.id, onRestart])

  return (
    <TerminalCard
      terminal={terminal}
      hasUnseen={hasUnseen && !isActive}
      isActive={isActive}
      onSelect={handleSelect}
      onClose={handleClose}
      onRestart={handleRestart}
    />
  )
}

// =============================================================================
// Memoized Card Components
// =============================================================================

interface MainTerminalCardProps {
  mainTerminal: TerminalInfo | null
  defaultClientId: string | null
  installedClients: ClientSummary[]
  hasUnseen: boolean
  isActive: boolean
  onSelect: () => void
  onRestart?: () => void
  onSelectClient: (clientId: string) => void
}

const MainTerminalCard = memo(function MainTerminalCard({
  mainTerminal,
  defaultClientId,
  installedClients,
  hasUnseen,
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

  // Agent selected but main terminal not yet created - show initializing state
  if (!mainTerminal) {
    return (
      <div
        className={cn(
          "group relative flex-shrink-0 w-36 h-28 rounded-xl transition-all",
          isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <div className="h-full rounded-xl bg-[#1a1a1a] border-2 border-purple-500/30 flex flex-col items-center justify-center overflow-hidden relative">
          {/* Mode indicator badge */}
          <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-purple-500/20 text-purple-400">
            <Home className="h-2 w-2" />
            main
          </div>

          <div className="animate-spin rounded-full border-2 border-muted border-t-purple-500 h-5 w-5 mb-1" />
          <span className="text-[8px] text-muted-foreground">Initializing...</span>
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
        getStatusBorderClass(hasUnseen, mainTerminal?.status),
        isStopped && "opacity-70"
      )}>
        {/* Mode indicator badge - top left */}
        <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-purple-500/20 text-purple-400">
          <Home className="h-2 w-2" />
          main
        </div>

        {/* Status indicator - center */}
        <div className="flex-1 flex items-center justify-center">
          {getStatusIndicator(hasUnseen, isStopped)}
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
})

interface TerminalCardProps {
  terminal: TerminalInfo
  hasUnseen: boolean
  isActive: boolean
  onSelect: () => void
  onClose: (shiftKey: boolean) => void
  onRestart: () => void
}

const TerminalCard = memo(function TerminalCard({
  terminal,
  hasUnseen,
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
        getStatusBorderClass(hasUnseen, terminal.status),
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

        {/* Status indicator - center */}
        <div className="flex-1 flex items-center justify-center">
          {getStatusIndicator(hasUnseen, isStopped)}
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
})
