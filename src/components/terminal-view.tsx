import { useEffect, useRef, useState, useCallback } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon } from "@xterm/addon-search"
import { Search, X, ChevronUp, ChevronDown, RotateCcw, Terminal as TerminalIcon } from "lucide-react"

import { useTerminalOutput } from "@/lib/tauri-events"
import { terminalApi } from "@/lib/api"
import { useMarkTerminalStopped, useReconnectTerminal } from "@/lib/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { cn } from "@/lib/utils"
import { getModeInfo } from "@/lib/terminal-utils"
import type { TerminalInfo } from "@/lib/types"

interface TerminalViewProps {
  terminalId: string
  terminal?: TerminalInfo
  currentBranch?: string
  onRestart?: () => void
  onClose?: () => void
}

export function TerminalView({
  terminalId,
  terminal,
  currentBranch = "",
  onRestart,
  onClose,
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const writtenCountRef = useRef(0)
  const inputHandlerAttached = useRef(false)
  // Track reconnect state locally per-terminal (NOT shared isPending from React Query)
  const isReconnectingRef = useRef(false)
  // Track previous status to detect transitions to "stopped"
  const prevStatusRef = useRef<string | undefined>(undefined)

  // Mutation to mark terminal as stopped when PTY is dead
  const { mutate: markStopped } = useMarkTerminalStopped()

  // Mutation to reconnect terminal (preserves history)
  // NOTE: Don't use isPending - it's shared across all components using this hook!
  const { mutate: reconnect } = useReconnectTerminal()

  // Get terminal output (auto-fetches history on first load, live updates via events)
  const terminalOutput = useTerminalOutput(terminalId)

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null)
  const [closeConfirmation, setCloseConfirmation] = useState(false)

  const isMain = terminal?.is_main ?? false
  const modeInfo = terminal ? getModeInfo(terminal.mode) : null
  const ModeIcon = modeInfo?.icon ?? TerminalIcon

  // Auto-reconnect when terminal status becomes "stopped" (PTY died)
  useEffect(() => {
    const currentStatus = terminal?.status
    const prevStatus = prevStatusRef.current

    // Detect transition to "stopped" - reset reconnecting flag for fresh attempt
    if (currentStatus === "stopped" && prevStatus !== "stopped") {
      console.log(
        `%c[TERMINAL STATUS CHANGE]%c ${prevStatus || "initial"} → stopped, resetting reconnect state`,
        "background: #f59e0b; color: black; padding: 2px 6px; border-radius: 3px;",
        "",
        terminalId
      )
      isReconnectingRef.current = false
    }

    // Update previous status
    prevStatusRef.current = currentStatus

    const shouldReconnect = currentStatus === "stopped" && !isReconnectingRef.current

    console.log(
      `%c[TERMINAL AUTO-RECONNECT CHECK]%c`,
      "background: #f59e0b; color: black; padding: 2px 6px; border-radius: 3px;",
      "",
      {
        terminalId,
        status: currentStatus,
        isReconnecting: isReconnectingRef.current,
        shouldReconnect,
      }
    )

    if (shouldReconnect) {
      console.warn(
        `%c[TERMINAL AUTO-RECONNECT]%c Initiating reconnect`,
        "background: #22c55e; color: white; padding: 2px 6px; border-radius: 3px;",
        "",
        terminalId
      )
      isReconnectingRef.current = true

      // Set a timeout in case the reconnect hangs
      const timeoutId = setTimeout(() => {
        console.error(
          `%c[TERMINAL AUTO-RECONNECT]%c Timeout after 10s`,
          "background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px;",
          "color: #ef4444;",
          terminalId
        )
        isReconnectingRef.current = false
      }, 10000)

      reconnect(terminalId, {
        onSuccess: () => {
          clearTimeout(timeoutId)
          console.log(
            `%c[TERMINAL AUTO-RECONNECT]%c Success`,
            "background: #22c55e; color: white; padding: 2px 6px; border-radius: 3px;",
            "color: #22c55e;",
            terminalId
          )
          // Reset the flag after a delay to allow future reconnects if needed
          setTimeout(() => {
            isReconnectingRef.current = false
          }, 5000)
        },
        onError: (reconnectErr) => {
          clearTimeout(timeoutId)
          console.error(
            `%c[TERMINAL AUTO-RECONNECT]%c Failed`,
            "background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px;",
            "color: #ef4444;",
            terminalId,
            reconnectErr
          )
          isReconnectingRef.current = false
        },
      })
    }
  }, [terminal?.status, terminalId, reconnect])

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

        // If PTY is not running, auto-reconnect (preserves history)
        if (errorMsg.includes("PTY is not running")) {
          console.log(
            `%c[TERMINAL WRITE ERROR]%c PTY not running`,
            "background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px;",
            "",
            { terminalId, isReconnecting: isReconnectingRef.current }
          )

          // If already reconnecting, just wait - don't spam reconnect attempts
          if (isReconnectingRef.current) {
            console.log("  Reconnect already in progress, waiting...")
            return
          }

          console.warn("  Initiating reconnect from write error handler")
          isReconnectingRef.current = true
          reconnect(terminalId, {
            onSuccess: () => {
              console.log("Terminal reconnected successfully (from write error):", terminalId)
              setTimeout(() => {
                isReconnectingRef.current = false
              }, 5000)
            },
            onError: (reconnectErr) => {
              console.error("Terminal reconnect failed (from write error):", reconnectErr)
              isReconnectingRef.current = false
              markStopped(terminalId)
            },
          })
          return
        }

        // If daemon connection is closed, don't try to reconnect - daemon needs to restart first
        if (errorMsg.includes("Daemon connection closed")) {
          console.warn("Daemon connection closed, waiting for daemon restart:", terminalId)
          // Reset reconnect state so we can try again after daemon restarts
          isReconnectingRef.current = false
          return
        }

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
  }, [terminalId, markStopped, reconnect])

  // Write terminal output incrementally (handles both history and live updates)
  useEffect(() => {
    if (!xtermRef.current) return

    // Detect if output was cleared (e.g., after restart)
    if (terminalOutput.length < writtenCountRef.current) {
      // Clear xterm display and reset counter
      xtermRef.current.clear()
      writtenCountRef.current = 0
      inputHandlerAttached.current = false
      isReconnectingRef.current = false
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
    <div className="terminal-container h-full w-full rounded-xl overflow-hidden flex flex-col border-2 border-gray-600/50 transition-all duration-300">
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
