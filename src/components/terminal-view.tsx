import { useEffect, useRef, useState, useCallback } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SearchAddon } from "@xterm/addon-search"
import { listen } from "@tauri-apps/api/event"
import { Search, X, ChevronUp, ChevronDown, RotateCcw, RefreshCw, XCircle } from "lucide-react"

import { useTerminalStore } from "@/stores/terminal-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TerminalOutput, TerminalInfo, ClientSummary } from "@/lib/types"

interface TerminalViewProps {
  terminalId: string
  terminal?: TerminalInfo
  clients?: ClientSummary[]
  onRestart?: () => void
  onSwitchAgent?: (clientId: string) => void
  onClose?: () => void
}

export function TerminalView({
  terminalId,
  terminal,
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

  const { writeToTerminal, terminalOutputs } = useTerminalStore()

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null)
  const [selectedNewAgent, setSelectedNewAgent] = useState<string>("")

  const isStopped = terminal?.status === "stopped"

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
  }, [isSearchOpen])

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

  return (
    <div className="terminal-container h-full w-full bg-[#1a1a1a] relative">
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
                e.shiftKey ? findPrevious() : findNext()
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

              {/* Close terminal */}
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                onClick={onClose}
              >
                <X className="h-4 w-4 mr-2" />
                Close Terminal
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal */}
      <div ref={terminalRef} className="h-full w-full" />
    </div>
  )
}
