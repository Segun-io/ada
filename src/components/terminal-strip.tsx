import { useState, useCallback, memo, useEffect } from "react"
import { Plus, X, RotateCcw, Home, Bot, AlertCircle } from "lucide-react"
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
import type { TerminalInfo, ClientSummary } from "@/lib/types"

interface TerminalStripProps {
  terminals: TerminalInfo[]
  clients: ClientSummary[]
  mainTerminal: TerminalInfo | null
  activeTerminalId: string | null
  defaultClientId: string | null
  onSelectTerminal: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
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
// Wrapper Components
// =============================================================================

interface MainTerminalCardWrapperProps {
  mainTerminal: TerminalInfo | null
  defaultClientId: string | null
  installedClients: ClientSummary[]
  isActive: boolean
  onSelect: (terminalId: string) => void
  onSelectClient: (clientId: string) => void
}

function MainTerminalCardWrapper({
  mainTerminal,
  defaultClientId,
  installedClients,
  isActive,
  onSelect,
  onSelectClient,
}: MainTerminalCardWrapperProps) {
  const handleSelect = useCallback(() => {
    if (mainTerminal) {
      onSelect(mainTerminal.id)
    }
  }, [mainTerminal, onSelect])

  return (
    <MainTerminalCard
      mainTerminal={mainTerminal}
      defaultClientId={defaultClientId}
      installedClients={installedClients}
      isActive={isActive}
      onSelect={handleSelect}
      onSelectClient={onSelectClient}
    />
  )
}

interface TerminalCardWrapperProps {
  terminal: TerminalInfo
  isActive: boolean
  onSelect: (terminalId: string) => void
  onClose: (terminal: TerminalInfo, shiftKey: boolean) => void
}

function TerminalCardWrapper({
  terminal,
  isActive,
  onSelect,
  onClose,
}: TerminalCardWrapperProps) {
  const handleSelect = useCallback(() => {
    onSelect(terminal.id)
  }, [terminal.id, onSelect])

  const handleClose = useCallback((shiftKey: boolean) => {
    onClose(terminal, shiftKey)
  }, [terminal, onClose])

  return (
    <TerminalCard
      terminal={terminal}
      isActive={isActive}
      onSelect={handleSelect}
      onClose={handleClose}
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
  isActive: boolean
  onSelect: () => void
  onSelectClient: (clientId: string) => void
}

const MainTerminalCard = memo(function MainTerminalCard({
  mainTerminal,
  defaultClientId,
  installedClients,
  isActive,
  onSelect,
  onSelectClient,
}: MainTerminalCardProps) {
  const hasAgent = !!defaultClientId

  // Track how long we've been waiting for terminal creation
  const [initializingTooLong, setInitializingTooLong] = useState(false)

  // If we have an agent but no terminal, start a timer to show error state
  useEffect(() => {
    if (hasAgent && !mainTerminal) {
      const timer = setTimeout(() => {
        setInitializingTooLong(true)
      }, 8000) // Show error state after 8 seconds
      return () => {
        clearTimeout(timer)
        setInitializingTooLong(false)
      }
    }
    // When terminal appears or agent is deselected, cleanup resets state
  }, [hasAgent, mainTerminal])

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

  // Agent selected but main terminal not yet created - show initializing or error state
  if (!mainTerminal) {
    // Show error state if initialization is taking too long
    if (initializingTooLong) {
      return (
        <div
          className={cn(
            "group relative flex-shrink-0 w-36 h-28 rounded-xl transition-all",
            isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
        >
          <div className="h-full rounded-xl bg-[#1a1a1a] border-2 border-yellow-500/50 flex flex-col items-center justify-center overflow-hidden relative">
            {/* Mode indicator badge */}
            <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-purple-500/20 text-purple-400">
              <Home className="h-2 w-2" />
              main
            </div>

            <AlertCircle className="h-4 w-4 text-yellow-500 mb-1" />
            <span className="text-[8px] text-yellow-500">Failed to start</span>
            <span className="text-[7px] text-muted-foreground mt-0.5">Check agent installation</span>

            {/* Retry button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[8px] mt-1 px-2"
              onClick={() => {
                // Re-selecting the same client will trigger re-creation
                onSelectClient(defaultClientId)
              }}
            >
              <RotateCcw className="h-2.5 w-2.5 mr-1" />
              Retry
            </Button>
          </div>
        </div>
      )
    }

    // Show initializing state
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
      <div className="h-full rounded-xl bg-[#1a1a1a] border-2 border-gray-600/50 flex flex-col overflow-hidden relative transition-colors">
        {/* Mode indicator badge - top left */}
        <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-purple-500/20 text-purple-400">
          <Home className="h-2 w-2" />
          main
        </div>

        {/* Center spacer */}
        <div className="flex-1" />

        {/* Name overlay - bottom with gradient */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <p className="text-[10px] font-medium text-white truncate">Main Terminal</p>
        </div>
      </div>
    </div>
  )
})

interface TerminalCardProps {
  terminal: TerminalInfo
  isActive: boolean
  onSelect: () => void
  onClose: (shiftKey: boolean) => void
}

const TerminalCard = memo(function TerminalCard({
  terminal,
  isActive,
  onSelect,
  onClose,
}: TerminalCardProps) {
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
      <div className="h-full rounded-xl bg-[#1a1a1a] border-2 border-gray-600/50 flex flex-col overflow-hidden relative transition-colors">
        {/* Mode indicator badge - top left */}
        <div className={cn(
          "absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium",
          modeInfo.bgColor,
          modeInfo.color
        )}>
          <ModeIcon className="h-2 w-2" />
          {modeInfo.label}
        </div>

        {/* Center spacer */}
        <div className="flex-1" />

        {/* Name overlay - bottom with gradient */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <p className="text-[10px] font-medium text-white truncate">{terminal.name}</p>
        </div>
      </div>
    </div>
  )
})
