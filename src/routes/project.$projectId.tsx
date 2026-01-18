import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState, useRef, useCallback } from "react"
import { Plus, Terminal as TerminalIcon, Settings, Loader2, Home, FolderOpen, TreeDeciduous, RefreshCw } from "lucide-react"
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
import { gitApi, projectApi } from "@/lib/api"
import type { BranchInfo, TerminalOutput, TerminalMode, WorktreeInfo } from "@/lib/types"
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

  const [, setBranches] = useState<BranchInfo[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>("")
  const [isCreateTerminalOpen, setIsCreateTerminalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [, setTick] = useState(0)
  const [hasInitialized, setHasInitialized] = useState(false)
  const mainTerminalCreatingRef = useRef(false)

  // Load project and terminals
  useEffect(() => {
    setHasInitialized(true)
    loadProject(projectId)
    loadTerminals(projectId)
    loadClients()
    detectInstalledClients()
  }, [projectId, loadProject, loadTerminals, loadClients, detectInstalledClients])

  // Find main terminal
  const mainTerminal = terminals.find(t => t.is_main) || null

  // Auto-create main terminal when default_client is set and no main terminal exists
  useEffect(() => {
    if (
      currentProject?.settings.default_client &&
      !mainTerminal &&
      !mainTerminalCreatingRef.current &&
      clients.length > 0
    ) {
      const defaultClient = clients.find(c => c.id === currentProject.settings.default_client && c.installed)
      if (defaultClient) {
        mainTerminalCreatingRef.current = true
        createMainTerminal(projectId, defaultClient.id)
          .catch(console.error)
          .finally(() => {
            mainTerminalCreatingRef.current = false
          })
      }
    }
  }, [currentProject?.settings.default_client, mainTerminal, clients, projectId, createMainTerminal])

  // Handle selecting a default client from the terminal strip
  const handleSelectDefaultClient = async (clientId: string) => {
    if (!currentProject) return

    // Save as project's default client
    await projectApi.updateSettings({
      project_id: projectId,
      default_client: clientId,
      auto_create_worktree: currentProject.settings.auto_create_worktree,
      worktree_base_path: currentProject.settings.worktree_base_path,
    })

    // Reload project to get updated settings (this will trigger main terminal creation)
    loadProject(projectId)
  }

  // Handle selecting main terminal
  const handleSelectMainTerminal = () => {
    if (mainTerminal) {
      setActiveTerminal(mainTerminal.id)
    }
  }

  // Handle refreshing project state (checks for git init, etc.)
  const handleRefreshProject = async () => {
    setIsRefreshing(true)
    try {
      await loadProject(projectId)
      // Also refresh git data
      if (currentProject?.is_git_repo) {
        await Promise.all([
          gitApi.getBranches(projectId).then(setBranches),
          gitApi.getCurrentBranch(projectId).then(setCurrentBranch),
          gitApi.listWorktrees(projectId).then(setWorktrees),
        ])
      }
    } catch (err) {
      console.error("Failed to refresh project:", err)
    } finally {
      setIsRefreshing(false)
    }
  }

  // Handle opening new terminal dialog (refresh project first)
  const handleNewTerminal = async () => {
    // Refresh project state first to detect any changes (e.g., git init)
    setIsRefreshing(true)
    try {
      await loadProject(projectId)
    } catch (err) {
      console.error("Failed to refresh project:", err)
    } finally {
      setIsRefreshing(false)
    }
    setIsCreateTerminalOpen(true)
  }

  // Check if main terminal is active
  const isMainTerminalActive = mainTerminal ? activeTerminalId === mainTerminal.id : false

  // Load branches and worktrees when project is loaded
  useEffect(() => {
    if (currentProject) {
      gitApi.getBranches(projectId).then(setBranches).catch(console.error)
      gitApi.getCurrentBranch(projectId).then(setCurrentBranch).catch(console.error)
      gitApi.listWorktrees(projectId).then(setWorktrees).catch(console.error)
    }
  }, [currentProject, projectId])

  // Callback to refresh branches and worktrees (for dialog)
  const refreshGitData = useCallback(async () => {
    const [branchesData, worktreesData] = await Promise.all([
      gitApi.getBranches(projectId),
      gitApi.listWorktrees(projectId),
    ])
    setBranches(branchesData)
    setWorktrees(worktreesData)
    return { branches: branchesData, worktrees: worktreesData }
  }, [projectId])

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
        return { icon: TerminalIcon, color: "text-green-400", label: "main" }
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
            size="icon"
            className="h-7 w-7"
            onClick={handleRefreshProject}
            disabled={isRefreshing}
            title="Refresh project state"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleNewTerminal}
            disabled={isRefreshing}
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
        mainTerminal={mainTerminal}
        defaultClientId={currentProject.settings.default_client}
        isMainTerminalActive={isMainTerminalActive}
        getActivity={getActivity}
        onSelectTerminal={setActiveTerminal}
        onSelectMainTerminal={handleSelectMainTerminal}
        onCloseTerminal={closeTerminal}
        onRestartTerminal={restartTerminal}
        onNewTerminal={handleNewTerminal}
        onSelectDefaultClient={handleSelectDefaultClient}
      />

      {/* Create Terminal Dialog */}
      <Dialog open={isCreateTerminalOpen} onOpenChange={setIsCreateTerminalOpen}>
        <CreateTerminalDialog
          projectId={projectId}
          projectPath={currentProject.path}
          isGitRepo={currentProject.is_git_repo}
          clients={clients}
          defaultClientId={currentProject.settings.default_client}
          existingTerminalNames={terminals.map(t => t.name)}
          worktrees={worktrees}
          onClose={() => setIsCreateTerminalOpen(false)}
          onRefreshData={refreshGitData}
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
        onSaved={async (updatedProject) => {
          // Reload project to get updated settings
          loadProject(updatedProject.id)

          // Sync main terminal with new default_client if it changed
          if (mainTerminal && updatedProject.settings.default_client) {
            if (mainTerminal.client_id !== updatedProject.settings.default_client) {
              await switchTerminalAgent(mainTerminal.id, updatedProject.settings.default_client)
            }
          }
        }}
      />
    </div>
  )
}

interface CreateTerminalDialogProps {
  projectId: string
  projectPath: string
  isGitRepo: boolean
  clients: Array<{ id: string; name: string; installed: boolean }>
  defaultClientId: string | null
  existingTerminalNames: string[]
  worktrees: WorktreeInfo[]
  onClose: () => void
  onRefreshData: () => Promise<{ branches: BranchInfo[]; worktrees: WorktreeInfo[] }>
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
  projectPath,
  isGitRepo,
  clients,
  defaultClientId,
  existingTerminalNames,
  worktrees: initialWorktrees,
  onClose,
  onRefreshData,
  onCreate,
}: CreateTerminalDialogProps) {
  const [name, setName] = useState("")
  const [clientId, setClientId] = useState(defaultClientId || "")
  const [mode, setMode] = useState<"folder" | "current_branch" | "worktree">("current_branch")
  const [folderPath, setFolderPath] = useState("")
  const [selectedWorktree, setSelectedWorktree] = useState("")
  const [worktreeMode, setWorktreeMode] = useState<"existing" | "new">("existing")
  const [baseBranch, setBaseBranch] = useState("")
  const [newBranchName, setNewBranchName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>(initialWorktrees)
  const [isLoading, setIsLoading] = useState(true)

  const installedClients = clients.filter((c) => c.installed)

  // Refresh branches and worktrees when dialog opens
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        const data = await onRefreshData()
        setBranches(data.branches)
        setWorktrees(data.worktrees)
      } catch (err) {
        console.error("Failed to load data:", err)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [onRefreshData])

  // Generate default terminal name based on mode
  const generateDefaultName = () => {
    let baseName: string

    switch (mode) {
      case "current_branch":
        baseName = "main"
        break
      case "folder":
        // Use the last segment of the folder path, or "folder" as fallback
        if (folderPath) {
          const segments = folderPath.split("/").filter(Boolean)
          baseName = segments[segments.length - 1] || "folder"
        } else {
          baseName = "folder"
        }
        break
      case "worktree":
        // Use the branch name (either from existing worktree or new branch)
        if (worktreeMode === "existing" && selectedWorktree) {
          const wt = worktrees.find(w => w.path === selectedWorktree)
          if (wt?.branch) {
            // Use last segment of branch name (e.g., "feature/auth" -> "auth")
            const segments = wt.branch.split("/").filter(Boolean)
            baseName = segments[segments.length - 1] || "worktree"
          } else {
            baseName = "worktree"
          }
        } else if (worktreeMode === "new" && newBranchName) {
          // Use last segment of new branch name
          const segments = newBranchName.split("/").filter(Boolean)
          baseName = segments[segments.length - 1] || "worktree"
        } else {
          baseName = "worktree"
        }
        break
      default:
        baseName = "terminal"
    }

    // Sanitize base name (replace non-alphanumeric with dash, lowercase)
    baseName = baseName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")

    // Find unique name with counter
    let counter = 1
    let candidateName = `${baseName}-${counter}`
    while (existingTerminalNames.includes(candidateName)) {
      counter++
      candidateName = `${baseName}-${counter}`
    }
    return candidateName
  }

  // Validate terminal name uniqueness
  const nameError = name && existingTerminalNames.includes(name)
    ? "A terminal with this name already exists"
    : null

  const handleBrowseFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: projectPath,
      title: "Select Folder",
    })

    if (selected) {
      // Make path relative to project
      if (selected.startsWith(projectPath)) {
        const relativePath = selected.slice(projectPath.length).replace(/^[/\\]/, "")
        setFolderPath(relativePath || ".")
      } else {
        setError("Please select a folder within the project directory")
      }
    }
  }

  const handleCreate = async () => {
    if (!clientId) return
    if (mode === "folder" && !folderPath) return
    if (mode === "worktree") {
      if (worktreeMode === "existing" && !selectedWorktree) return
      if (worktreeMode === "new" && (!baseBranch || !newBranchName)) return
    }

    // Generate name if not provided
    const finalName = name.trim() || generateDefaultName()

    // Final validation
    if (existingTerminalNames.includes(finalName)) {
      setError("A terminal with this name already exists")
      return
    }

    setIsCreating(true)
    setError(null)
    try {
      // Determine worktree branch
      let worktreeBranch: string | null = null
      if (mode === "worktree") {
        if (worktreeMode === "existing") {
          const wt = worktrees.find(w => w.path === selectedWorktree)
          worktreeBranch = wt?.branch || null
        } else {
          // For new worktree, we pass a special format: wt-baseBranch/newBranchName
          // The backend will handle creating the worktree with git worktree add -b newBranchName .worktrees/newBranchName baseBranch
          worktreeBranch = `wt-${baseBranch}/${newBranchName}`
        }
      }

      await onCreate({
        project_id: projectId,
        name: finalName,
        client_id: clientId,
        mode,
        folder_path: mode === "folder" ? folderPath : null,
        worktree_branch: worktreeBranch,
      })
    } catch (err) {
      console.error("Failed to create terminal:", err)
      setError(String(err))
    } finally {
      setIsCreating(false)
    }
  }

  const isValid = clientId && !nameError && (
    mode === "current_branch" ||
    (mode === "folder" && folderPath) ||
    (mode === "worktree" && (
      (worktreeMode === "existing" && selectedWorktree) ||
      (worktreeMode === "new" && baseBranch && newBranchName)
    ))
  )

  // Common input props to disable autocorrect
  const inputProps = {
    autoComplete: "off",
    autoCorrect: "off",
    spellCheck: false,
    autoCapitalize: "off",
  } as const

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create New Terminal</DialogTitle>
        <DialogDescription>
          Spawn a new AI code agent terminal with a specific mode.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        {/* Terminal Name (optional) */}
        <div className="grid gap-2">
          <Label htmlFor="terminal-name">Terminal Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <Input
            id="terminal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={generateDefaultName()}
            className={nameError ? "border-destructive" : ""}
            {...inputProps}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>

        {/* AI Client */}
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
          <Tabs value={mode} onValueChange={(v) => { setMode(v as typeof mode); setError(null) }}>
            <TabsList className={`grid w-full ${isGitRepo ? "grid-cols-3" : "grid-cols-2"}`}>
              <TabsTrigger value="current_branch" className="flex items-center gap-1 text-xs">
                <Home className="h-3 w-3" />
                Main
              </TabsTrigger>
              <TabsTrigger value="folder" className="flex items-center gap-1 text-xs">
                <FolderOpen className="h-3 w-3" />
                Folder
              </TabsTrigger>
              {isGitRepo && (
                <TabsTrigger value="worktree" className="flex items-center gap-1 text-xs">
                  <TreeDeciduous className="h-3 w-3" />
                  Worktree
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="current_branch" className="mt-3">
              <p className="text-xs text-muted-foreground">
                Runs at project root on the current branch. Same as the main terminal but can be closed.
              </p>
            </TabsContent>

            <TabsContent value="folder" className="mt-3 space-y-2">
              <Label htmlFor="folder-path">Folder Path</Label>
              <div className="flex gap-2">
                <Input
                  id="folder-path"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="src/components"
                  className="flex-1"
                  {...inputProps}
                />
                <Button variant="outline" onClick={handleBrowseFolder}>
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs in a subfolder of the project.
              </p>
            </TabsContent>

            {isGitRepo && (
              <TabsContent value="worktree" className="mt-3 space-y-3">
                {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-xs text-muted-foreground">Loading...</span>
                </div>
              ) : (
                <>
                  {/* Worktree mode toggle */}
                  <Tabs
                    value={worktreeMode}
                    onValueChange={(v) => {
                      setWorktreeMode(v as typeof worktreeMode)
                      setError(null) // Clear error when switching tabs
                    }}
                  >
                    <TabsList className="grid w-full grid-cols-2 h-8">
                      <TabsTrigger value="existing" className="text-xs">Use Existing</TabsTrigger>
                      <TabsTrigger value="new" className="text-xs">Create New</TabsTrigger>
                    </TabsList>

                    <TabsContent value="existing" className="mt-2 space-y-2">
                      {worktrees.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">
                          No worktrees available. Create a new one instead.
                        </p>
                      ) : (
                        <>
                          <Label>Select Worktree</Label>
                          <Select value={selectedWorktree} onValueChange={setSelectedWorktree}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a worktree" />
                            </SelectTrigger>
                            <SelectContent>
                              {worktrees.map((wt) => (
                                <SelectItem key={wt.path} value={wt.path}>
                                  {wt.branch} <span className="text-muted-foreground">({wt.path.split("/").pop()})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </TabsContent>

                    <TabsContent value="new" className="mt-2 space-y-2">
                      <div className="space-y-1">
                        <Label>Base Branch</Label>
                        {branches.filter(b => !b.is_remote).length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">
                            No local branches available.
                          </p>
                        ) : (
                          <Select value={baseBranch} onValueChange={setBaseBranch}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select base branch" />
                            </SelectTrigger>
                            <SelectContent>
                              {branches.filter(b => !b.is_remote).map((b) => (
                                <SelectItem key={b.name} value={b.name}>
                                  {b.name} {b.is_current && "(current)"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label>New Branch Name</Label>
                        <Input
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value.replace(/\s+/g, "-"))}
                          placeholder="feature/my-feature"
                          {...inputProps}
                        />
                      </div>

                      {baseBranch && newBranchName && (
                        <div className="rounded-md bg-muted p-2 space-y-1">
                          <p className="text-xs font-medium">Worktree will be created:</p>
                          <code className="text-xs block break-all">
                            wt-{baseBranch}/{newBranchName}
                          </code>
                          <p className="text-[10px] text-muted-foreground">
                            Branch <span className="font-mono">{newBranchName}</span> from <span className="font-mono">{baseBranch}</span>
                          </p>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              )}
              </TabsContent>
            )}
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
        <Button onClick={handleCreate} disabled={!isValid || isCreating || isLoading}>
          {isCreating ? "Creating..." : "Create Terminal"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

