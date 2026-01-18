import { useEffect, useRef, useState, useCallback } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon } from "@xterm/addon-search"
import { listen } from "@tauri-apps/api/event"
import { Search, X, ChevronUp, ChevronDown, RotateCcw, RefreshCw, XCircle, Home, FolderOpen, TreeDeciduous, Terminal as TerminalIcon } from "lucide-react"

import { useTerminalUIStore } from "@/stores/terminal-ui-store"
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
import type { TerminalOutput, TerminalInfo, ClientSummary, AgentActivity, TerminalMode } from "@/lib/types"

// Get mode display info
const getModeInfo = (mode: TerminalMode) => {
  switch (mode) {
    case "main":
      return { icon: Home, color: "text-purple-400", bgColor: "bg-purple-500/20", label: "main" }
    case "folder":
      return { icon: FolderOpen, color: "text-orange-400", bgColor: "bg-orange-500/20", label: "folder" }
    case "current_branch":
      return { icon: TerminalIcon, color: "text-green-400", bgColor: "bg-green-500/20", label: "main" }
    case "worktree":
      return { icon: TreeDeciduous, color: "text-blue-400", bgColor: "bg-blue-500/20", label: "worktree" }
    default:
      return { icon: TerminalIcon, color: "text-muted-foreground", bgColor: "bg-muted", label: mode }
  }
}

// Get border color based on activity
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

  const { writeToTerminal, terminalOutputs } = useTerminalUIStore()

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

    // Handle user input
    terminal.onData((data) => {
      writeToTerminal(terminalId, data).catch(console.error)
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    })

    resizeObserver.observe(terminalRef.current)

    // Write any existing output
    const existingOutput = terminalOutputs[terminalId]
    if (existingOutput) {
      existingOutput.forEach((data) => terminal.write(data))
    }

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
  }, [terminalId, writeToTerminal])

  // Listen for terminal output
  useEffect(() => {
    const unlisten = listen<TerminalOutput>("terminal-output", (event) => {
      if (event.payload.terminal_id === terminalId && xtermRef.current) {
        xtermRef.current.write(event.payload.data)
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [terminalId])

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

        {/* Right: Close Button (hidden for main terminal) */}
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
        {isMain && <div className="w-6" />}
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
                  The agent process has exited. What would you like to do?
                </p>
              </div>

              <div className="space-y-3">
                {/* Restart with same agent */}
                <Button
                  variant="default"
                  className="w-full"
                  onClick={onRestart}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restart Agent
                </Button>

                {/* Switch agent */}
                {clients.length > 1 && onSwitchAgent && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Select
                        value={selectedNewAgent}
                        onValueChange={setSelectedNewAgent}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select different agent" />
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
                {!isMain && (
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:text-destructive"
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
