import { useEffect, useRef, useState, useCallback } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon } from "@xterm/addon-search"
import { Search, X, ChevronUp, ChevronDown, RotateCcw, RefreshCw, XCircle, Terminal as TerminalIcon } from "lucide-react"

import { useTerminalOutput } from "@/lib/tauri-events"
import { terminalApi } from "@/lib/api"
import { useMarkTerminalStopped } from "@/lib/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { cn } from "@/lib/utils"
import { getModeInfo, getActivityBorderClass } from "@/lib/terminal-utils"
import type { TerminalInfo, ClientSummary, AgentActivity } from "@/lib/types"

interface TerminalViewProps {
  terminalId: string
  terminal?: TerminalInfo
  activity?: AgentActivity
  currentBranch?: string
  clients?: ClientSummary[]
  onRestart?: () => void
  onSwitchAgent?: (clientId: string) => void
  onClose?: () => void
}

export function TerminalView({
  terminalId,
  terminal,
  activity = "idle",
  currentBranch = "",
  clients = [],
  onRestart,
  onSwitchAgent,
  onClose,
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const writtenCountRef = useRef(0)
  const inputHandlerAttached = useRef(false)

  // Mutation to mark terminal as stopped when PTY is dead
  const { mutate: markStopped } = useMarkTerminalStopped()

  // Get terminal output (auto-fetches history on first load, live updates via events)
  const terminalOutput = useTerminalOutput(terminalId)

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null)
  const [selectedNewAgent, setSelectedNewAgent] = useState<string>("")
  const [closeConfirmation, setCloseConfirmation] = useState(false)

  const isStopped = terminal?.status === "stopped"
  const isMain = terminal?.is_main ?? false
  const modeInfo = terminal ? getModeInfo(terminal.mode) : null
  const ModeIcon = modeInfo?.icon ?? TerminalIcon

  // Get context info for header
  const getContextInfo = () => {
    if (!terminal) return ""
    switch (terminal.mode) {
      case "main":
      case "current_branch":
        return terminal.branch || currentBranch || "main"
      case "worktree":
        // Show "branch → source" format for worktrees
        return terminal.branch || "worktree"
      case "folder":
        return terminal.folder_path || "root"
      default:
        return ""
    }
  }

  const handleClose = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click bypasses confirmation
      onClose?.()
    } else {
      setCloseConfirmation(true)
    }
  }

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#ffffff",
        cursorAccent: "#1a1a1a",
        selectionBackground: "rgba(255, 255, 255, 0.3)",
        black: "#000000",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#abb2bf",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
      allowTransparency: true,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(searchAddon)

    terminal.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = terminal
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon
    inputHandlerAttached.current = false

    // Note: onData handler is attached AFTER history is loaded (in output effect)
    // This prevents xterm.js escape sequence responses during history replay
    // from being sent to the PTY

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    })

    resizeObserver.observe(terminalRef.current)

    // Reset written count when terminal changes
    writtenCountRef.current = 0

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      writtenCountRef.current = 0
      inputHandlerAttached.current = false
    }
  }, [terminalId])

  // Attach input handler to terminal (must be done after initial history load)
  const attachInputHandler = useCallback(() => {
    if (!xtermRef.current || inputHandlerAttached.current) return

    xtermRef.current.onData((data) => {
      terminalApi.write(terminalId, data).catch((err) => {
        const errorMsg = String(err)
        // If we get an I/O error, the PTY is dead - mark terminal as stopped
        if (errorMsg.includes("Input/output error") || errorMsg.includes("os error 5")) {
          console.warn("Terminal PTY is dead, marking as stopped:", terminalId)
          markStopped(terminalId)
        } else {
          console.error("Terminal write error:", err)
        }
      })
    })
    inputHandlerAttached.current = true
  }, [terminalId, markStopped])

  // Write terminal output incrementally (handles both history and live updates)
  useEffect(() => {
    if (!xtermRef.current) return

    // Detect if output was cleared (e.g., after restart)
    if (terminalOutput.length < writtenCountRef.current) {
      // Clear xterm display and reset counter
      xtermRef.current.clear()
      writtenCountRef.current = 0
      inputHandlerAttached.current = false
    }

    if (terminalOutput.length === 0) {
      // No history yet, but still attach handler so user can type
      attachInputHandler()
      return
    }

    // Write only new output that hasn't been written yet
    const newItems = terminalOutput.slice(writtenCountRef.current)
    if (newItems.length > 0) {
      newItems.forEach((data) => xtermRef.current?.write(data))
      writtenCountRef.current = terminalOutput.length
    }

    // Attach input handler after history is written
    attachInputHandler()
  }, [terminalOutput, attachInputHandler])

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
    if (searchAddonRef.current && query) {
      const found = searchAddonRef.current.findNext(query, {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      })
      // SearchAddon doesn't provide a count, so we just indicate if found
      setSearchResultCount(found ? 1 : 0)
    } else {
      setSearchResultCount(null)
    }
  }, [])

  const findNext = useCallback(() => {
    if (searchAddonRef.current && searchQuery) {
      searchAddonRef.current.findNext(searchQuery, {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      })
    }
  }, [searchQuery])

  const findPrevious = useCallback(() => {
    if (searchAddonRef.current && searchQuery) {
      searchAddonRef.current.findPrevious(searchQuery, {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      })
    }
  }, [searchQuery])

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false)
    setSearchQuery("")
    setSearchResultCount(null)
    searchAddonRef.current?.clearDecorations()
    xtermRef.current?.focus()
  }, [])

  // Handle keyboard shortcut for search (Cmd/Ctrl + F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        setIsSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (e.key === "Escape" && isSearchOpen) {
        closeSearch()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isSearchOpen, closeSearch])

  return (
    <div className={cn(
      "terminal-container h-full w-full rounded-xl overflow-hidden flex flex-col border-2 transition-all duration-300",
      getActivityBorderClass(activity, terminal?.status)
    )}>
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#252525] border-b border-border/50">
        {/* Left: Mode Badge */}
        {modeInfo && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
            modeInfo.bgColor,
            modeInfo.color
          )}>
            <ModeIcon className="h-3 w-3" />
            {modeInfo.label}
          </div>
        )}

        {/* Center: Terminal Name + Context */}
        <div className="flex-1 flex items-center justify-center gap-2 text-xs">
          <span className="font-medium text-foreground">{terminal?.name || "Terminal"}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{getContextInfo()}</span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Restart Button */}
          {onRestart && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onRestart}
              title="Restart terminal (clears history)"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* Close Button (hidden for main terminal) */}
          {!isMain && onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              title="Close terminal (Shift+click to skip confirmation)"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 bg-[#1a1a1a] relative">
        {/* Search Bar */}
        {isSearchOpen && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-background border border-border rounded-md p-1 shadow-lg">
            <Search className="h-4 w-4 text-muted-foreground ml-2" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.shiftKey) {
                    findPrevious()
                  } else {
                    findNext()
                  }
                }
              }}
              placeholder="Search..."
              className="h-7 w-48 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {searchResultCount !== null && (
              <span className="text-xs text-muted-foreground px-1">
                {searchResultCount === 0 ? "No results" : "Found"}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={findPrevious}
              disabled={!searchQuery}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={findNext}
              disabled={!searchQuery}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={closeSearch}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Stopped Overlay */}
        {isStopped && (
          <div className="absolute inset-0 z-20 bg-black/60 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-background border border-border rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
              <div className="text-center">
                <div className="h-12 w-12 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-3">
                  <XCircle className="h-6 w-6 text-yellow-500" />
                </div>
                <h3 className="font-semibold text-lg">Agent Stopped</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  The agent process has exited.
                </p>
              </div>

              <div className="space-y-3">
                {/* Restart with same agent */}
                {(() => {
                  const currentClient = clients.find(c => c.id === terminal?.client_id)
                  return (
                    <div className="space-y-2">
                      <Button
                        variant="default"
                        className="w-full"
                        onClick={onRestart}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restart {currentClient?.name || "Agent"}
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        Starts fresh session (history cleared)
                      </p>
                    </div>
                  )
                })()}

                {/* Switch agent */}
                {clients.length > 1 && onSwitchAgent && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground">Or switch to a different agent:</p>
                    <div className="flex gap-2">
                      <Select
                        value={selectedNewAgent}
                        onValueChange={setSelectedNewAgent}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select agent..." />
                        </SelectTrigger>
                        <SelectContent>
                          {clients
                            .filter((c) => c.id !== terminal?.client_id)
                            .map((client) => (
                              <SelectItem key={client.id} value={client.id}>
                                {client.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="secondary"
                        disabled={!selectedNewAgent}
                        onClick={() => {
                          if (selectedNewAgent) {
                            onSwitchAgent(selectedNewAgent)
                            setSelectedNewAgent("")
                          }
                        }}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Close terminal (not for main) */}
                {!isMain && onClose && (
                  <Button
                    variant="ghost"
                    className="w-full text-muted-foreground hover:text-destructive"
                    onClick={onClose}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Close Terminal
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Terminal */}
        <div ref={terminalRef} className="h-full w-full" />
      </div>

      {/* Close Confirmation Dialog */}
      <ConfirmationDialog
        open={closeConfirmation}
        title="Close Terminal"
        description={`Are you sure you want to close "${terminal?.name || "this terminal"}"? The agent process will be terminated.`}
        confirmText="Close"
        variant="destructive"
        onConfirm={() => {
          setCloseConfirmation(false)
          onClose?.()
        }}
        onCancel={() => setCloseConfirmation(false)}
      />
    </div>
  )
}
