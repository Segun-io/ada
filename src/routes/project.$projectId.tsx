import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState, useRef } from "react"
import { Plus, Terminal as TerminalIcon, Settings, Loader2, Home, FolderOpen, GitBranch, TreeDeciduous } from "lucide-react"
import { listen } from "@tauri-apps/api/event"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { useProjectStore } from "@/stores/project-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { useClientStore } from "@/stores/client-store"
import { gitApi } from "@/lib/api"
import type { BranchInfo, TerminalOutput, TerminalMode } from "@/lib/types"
import { TerminalView } from "@/components/terminal-view"
import { TerminalStrip } from "@/components/terminal-strip"
import { ProjectSettings } from "@/components/project-settings"

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  const navigate = useNavigate()

  const { projects, currentProject, loadProject, isLoading: isProjectLoading, error: projectError } = useProjectStore()
  const {
    terminals,
    activeTerminalId,
    loadTerminals,
    createTerminal,
    createMainTerminal,
    closeTerminal,
    restartTerminal,
    markTerminalStopped,
    switchTerminalAgent,
    loadTerminalHistory,
    setActiveTerminal,
    appendOutput,
    getActivity,
  } = useTerminalStore()
  const { clients, loadClients, detectInstalledClients } = useClientStore()

  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>("")
  const [isCreateTerminalOpen, setIsCreateTerminalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [, setTick] = useState(0)
  const mainTerminalCreated = useRef(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  // Load project and terminals
  useEffect(() => {
    setHasInitialized(true)
    loadProject(projectId)
    loadTerminals(projectId)
    loadClients()
    detectInstalledClients()
  }, [projectId, loadProject, loadTerminals, loadClients, detectInstalledClients])

  // Auto-create main terminal when project loads
  useEffect(() => {
    if (currentProject && !mainTerminalCreated.current) {
      const hasMainTerminal = terminals.some(t => t.is_main)
      if (!hasMainTerminal) {
        // Find first installed client
        const installedClient = clients.find(c => c.installed)
        if (installedClient) {
          mainTerminalCreated.current = true
          createMainTerminal(projectId, installedClient.id).catch(console.error)
        }
      } else {
        mainTerminalCreated.current = true
      }
    }
  }, [currentProject, terminals, clients, projectId, createMainTerminal])

  // Load branches when project is loaded
  useEffect(() => {
    if (currentProject) {
      gitApi.getBranches(projectId).then(setBranches).catch(console.error)
      gitApi.getCurrentBranch(projectId).then(setCurrentBranch).catch(console.error)
    }
  }, [currentProject, projectId])

  // Listen for terminal output events
  useEffect(() => {
    const unlisten = listen<TerminalOutput>("terminal-output", (event) => {
      appendOutput(event.payload.terminal_id, event.payload.data)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [appendOutput])

  // Listen for terminal closed events
  useEffect(() => {
    const unlisten = listen<string>("terminal-closed", (event) => {
      console.log("Terminal closed:", event.payload)
      markTerminalStopped(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [markTerminalStopped])

  // Load terminal history when active terminal changes
  useEffect(() => {
    if (activeTerminalId) {
      loadTerminalHistory(activeTerminalId)
    }
  }, [activeTerminalId, loadTerminalHistory])

  // Periodic tick to update activity status displays
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Check if project exists in the list
  const projectExists = projects.some(p => p.id === projectId)

  // Track if we've ever successfully loaded this project (reset when projectId changes)
  const hadProjectLoaded = useRef(false)
  const lastProjectId = useRef(projectId)
  if (lastProjectId.current !== projectId) {
    hadProjectLoaded.current = false
    lastProjectId.current = projectId
  }
  if (currentProject?.id === projectId) {
    hadProjectLoaded.current = true
  }

  // Redirect to home if:
  // 1. Project failed to load (error from backend)
  // 2. Project was deleted (we had it loaded, now it's gone)
  useEffect(() => {
    // Don't redirect before initialization or while still loading
    if (!hasInitialized || isProjectLoading) return

    // Project load failed with error
    if (projectError) {
      navigate({ to: "/" })
      return
    }

    // Project was deleted: we previously had it loaded, but now currentProject is null
    // and it's no longer in the projects list
    if (hadProjectLoaded.current && !currentProject && !projectExists) {
      navigate({ to: "/" })
    }
  }, [hasInitialized, projectError, isProjectLoading, projectExists, currentProject, navigate])

  // Show loading while initializing or loading
  if (!hasInitialized || isProjectLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 animate-spin rounded-full border-4 border-muted border-t-primary h-8 w-8 mx-auto" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    )
  }

  // If we're about to redirect (error or no project), show nothing
  if (projectError || !currentProject || currentProject.id !== projectId) {
    return null
  }

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId)
  const activeClientName = activeTerminal
    ? clients.find((c) => c.id === activeTerminal.client_id)?.name || activeTerminal.client_id
    : ""
  const activeActivity = activeTerminalId ? getActivity(activeTerminalId) : "idle"

  // Get mode display info
  const getModeInfo = (mode: TerminalMode) => {
    switch (mode) {
      case "main":
        return { icon: Home, color: "text-purple-400", label: "main" }
      case "folder":
        return { icon: FolderOpen, color: "text-orange-400", label: "folder" }
      case "current_branch":
        return { icon: GitBranch, color: "text-green-400", label: "branch" }
      case "worktree":
        return { icon: TreeDeciduous, color: "text-blue-400", label: "worktree" }
      default:
        return { icon: TerminalIcon, color: "text-muted-foreground", label: mode }
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{currentProject.name}:</span>
          {activeTerminal ? (
            <>
              {/* Mode indicator */}
              {(() => {
                const modeInfo = getModeInfo(activeTerminal.mode)
                const ModeIcon = modeInfo.icon
                return (
                  <span className={`flex items-center gap-1 ${modeInfo.color}`}>
                    <ModeIcon className="h-3.5 w-3.5" />
                    {modeInfo.label}
                  </span>
                )
              })()}
              <span className="text-muted-foreground">-</span>
              <span className="text-muted-foreground">{activeTerminal.name}</span>
              <span className="text-muted-foreground">-</span>
              <span className="text-muted-foreground">
                {activeTerminal.mode === "folder"
                  ? activeTerminal.folder_path || "root"
                  : activeTerminal.branch || currentBranch || "main"}
              </span>
              <span className="text-muted-foreground">-</span>
              <span className="text-muted-foreground">{activeClientName}</span>
              <span className="text-muted-foreground">|</span>
              {/* Terminal Status */}
              {activeTerminal.status === "stopped" ? (
                <span className="flex items-center gap-1 text-yellow-500">
                  <span className="h-2 w-2 rounded-full bg-yellow-500" />
                  stopped
                </span>
              ) : activeTerminal.status === "running" ? (
                <span className="flex items-center gap-1 text-green-500">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  running
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-gray-500" />
                  {activeTerminal.status}
                </span>
              )}
              {/* Agent Activity (only show if running) */}
              {activeTerminal.status === "running" && (
                <>
                  <span className="text-muted-foreground">|</span>
                  {activeActivity === "thinking" ? (
                    <span className="flex items-center gap-1 text-blue-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      thinking
                    </span>
                  ) : activeActivity === "active" ? (
                    <span className="flex items-center gap-1 text-green-400">
                      <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                      active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-gray-500" />
                      idle
                    </span>
                  )}
                </>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No terminal selected</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIsCreateTerminalOpen(true)}
          >
            new code terminal <Plus className="ml-1 h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Terminal View */}
      <div className="flex-1 p-3 min-h-0">
        <div
          className={`h-full rounded-xl overflow-hidden bg-[#1a1a1a] transition-all duration-300 ${
            activeTerminal?.status === "stopped"
              ? "ring-2 ring-yellow-500/50"
              : activeActivity === "thinking"
              ? "ring-2 ring-blue-500/50 animate-pulse"
              : activeActivity === "active"
              ? "ring-2 ring-green-500/50"
              : "border border-border"
          }`}
        >
          {activeTerminal ? (
            <TerminalView
              terminalId={activeTerminal.id}
              terminal={activeTerminal}
              clients={clients.filter(c => c.installed)}
              onRestart={() => restartTerminal(activeTerminal.id)}
              onSwitchAgent={(clientId) => switchTerminalAgent(activeTerminal.id, clientId)}
              onClose={() => closeTerminal(activeTerminal.id)}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground">
                <TerminalIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">terminal</p>
                <p className="text-xs mt-2">Select or create a terminal to get started</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Strip */}
      <TerminalStrip
        terminals={terminals}
        clients={clients}
        activeTerminalId={activeTerminalId}
        getActivity={getActivity}
        onSelectTerminal={setActiveTerminal}
        onCloseTerminal={closeTerminal}
        onRestartTerminal={restartTerminal}
        onNewTerminal={() => setIsCreateTerminalOpen(true)}
      />

      {/* Create Terminal Dialog */}
      <Dialog open={isCreateTerminalOpen} onOpenChange={setIsCreateTerminalOpen}>
        <CreateTerminalDialog
          projectId={projectId}
          clients={clients}
          branches={branches}
          onClose={() => setIsCreateTerminalOpen(false)}
          onCreate={async (request) => {
            await createTerminal(request)
            setIsCreateTerminalOpen(false)
          }}
        />
      </Dialog>

      {/* Project Settings Dialog */}
      <ProjectSettings
        project={currentProject}
        clients={clients}
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSaved={(updatedProject) => {
          // Reload project to get updated settings
          loadProject(updatedProject.id)
        }}
      />
    </div>
  )
}

interface CreateTerminalDialogProps {
  projectId: string
  clients: Array<{ id: string; name: string; installed: boolean }>
  branches: BranchInfo[]
  onClose: () => void
  onCreate: (request: {
    project_id: string
    name: string
    client_id: string
    mode: TerminalMode
    folder_path: string | null
    worktree_branch: string | null
  }) => Promise<void>
}

function CreateTerminalDialog({
  projectId,
  clients,
  branches,
  onClose,
  onCreate,
}: CreateTerminalDialogProps) {
  const [name, setName] = useState("")
  const [clientId, setClientId] = useState("")
  const [mode, setMode] = useState<"folder" | "current_branch" | "worktree">("current_branch")
  const [folderPath, setFolderPath] = useState("")
  const [worktreeBranch, setWorktreeBranch] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const installedClients = clients.filter((c) => c.installed)

  const handleCreate = async () => {
    if (!name || !clientId) return
    if (mode === "folder" && !folderPath) return
    if (mode === "worktree" && !worktreeBranch) return

    setIsCreating(true)
    setError(null)
    try {
      await onCreate({
        project_id: projectId,
        name,
        client_id: clientId,
        mode,
        folder_path: mode === "folder" ? folderPath : null,
        worktree_branch: mode === "worktree" ? worktreeBranch : null,
      })
    } catch (err) {
      console.error("Failed to create terminal:", err)
      setError(String(err))
    } finally {
      setIsCreating(false)
    }
  }

  const isValid = name && clientId && (
    mode === "current_branch" ||
    (mode === "folder" && folderPath) ||
    (mode === "worktree" && worktreeBranch)
  )

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create New Terminal</DialogTitle>
        <DialogDescription>
          Spawn a new AI code agent terminal with a specific mode.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        {/* Common fields */}
        <div className="grid gap-2">
          <Label htmlFor="terminal-name">Terminal Name</Label>
          <Input
            id="terminal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="feature-auth"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="client">AI Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an AI client" />
            </SelectTrigger>
            <SelectContent>
              {installedClients.length === 0 ? (
                <SelectItem value="none" disabled>
                  No clients installed
                </SelectItem>
              ) : (
                installedClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Mode selection tabs */}
        <div className="grid gap-2">
          <Label>Terminal Mode</Label>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="current_branch" className="flex items-center gap-1 text-xs">
                <GitBranch className="h-3 w-3" />
                Branch
              </TabsTrigger>
              <TabsTrigger value="folder" className="flex items-center gap-1 text-xs">
                <FolderOpen className="h-3 w-3" />
                Folder
              </TabsTrigger>
              <TabsTrigger value="worktree" className="flex items-center gap-1 text-xs">
                <TreeDeciduous className="h-3 w-3" />
                Worktree
              </TabsTrigger>
            </TabsList>

            <TabsContent value="current_branch" className="mt-3">
              <p className="text-xs text-muted-foreground">
                Runs at project root on the current branch.
              </p>
            </TabsContent>

            <TabsContent value="folder" className="mt-3 space-y-2">
              <Label htmlFor="folder-path">Folder Path</Label>
              <Input
                id="folder-path"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="src/components"
              />
              <p className="text-xs text-muted-foreground">
                Runs in a subfolder of the project.
              </p>
            </TabsContent>

            <TabsContent value="worktree" className="mt-3 space-y-2">
              <Label htmlFor="worktree-branch">Branch</Label>
              <Select value={worktreeBranch} onValueChange={setWorktreeBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="Select or enter a branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches
                    .filter((b) => !b.is_remote)
                    .map((b) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name} {b.is_current && "(current)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                value={worktreeBranch}
                onChange={(e) => setWorktreeBranch(e.target.value)}
                placeholder="Or type a new branch name"
              />
              <p className="text-xs text-muted-foreground">
                Runs in an isolated git worktree for branch work.
              </p>
            </TabsContent>
          </Tabs>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={!isValid || isCreating}>
          {isCreating ? "Creating..." : "Create Terminal"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
