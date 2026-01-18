import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Plus, Terminal as TerminalIcon, Settings, Loader2 } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { useProjectStore } from "@/stores/project-store"
import { useTerminalStore } from "@/stores/terminal-store"
import { useClientStore } from "@/stores/client-store"
import { gitApi } from "@/lib/api"
import type { BranchInfo, TerminalOutput } from "@/lib/types"
import { TerminalView } from "@/components/terminal-view"
import { TerminalStrip } from "@/components/terminal-strip"
import { ProjectSettings } from "@/components/project-settings"

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()

  const { currentProject, loadProject } = useProjectStore()
  const {
    terminals,
    activeTerminalId,
    loadTerminals,
    createTerminal,
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

  // Load project and terminals
  useEffect(() => {
    loadProject(projectId)
    loadTerminals(projectId)
    loadClients()
    detectInstalledClients()
  }, [projectId, loadProject, loadTerminals, loadClients, detectInstalledClients])

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

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 animate-spin rounded-full border-4 border-muted border-t-primary h-8 w-8 mx-auto" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    )
  }

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId)
  const activeClientName = activeTerminal
    ? clients.find((c) => c.id === activeTerminal.client_id)?.name || activeTerminal.client_id
    : ""
  const activeActivity = activeTerminalId ? getActivity(activeTerminalId) : "idle"

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{currentProject.name}:</span>
          {activeTerminal ? (
            <>
              <span className="text-muted-foreground">{activeTerminal.name}</span>
              <span className="text-muted-foreground">-</span>
              <span className="text-muted-foreground">{activeTerminal.branch || currentBranch || "main"}</span>
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
    branch: string | null
    use_worktree: boolean
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
  const [branch, setBranch] = useState<string>("")
  const [newBranchName, setNewBranchName] = useState("")
  const [isCreatingNewBranch, setIsCreatingNewBranch] = useState(false)
  const [useWorktree, setUseWorktree] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const installedClients = clients.filter((c) => c.installed)
  const effectiveBranch = isCreatingNewBranch ? newBranchName : branch

  const handleCreate = async () => {
    if (!name || !clientId) return
    // If creating new branch, must have worktree enabled and a branch name
    if (isCreatingNewBranch && !newBranchName) return
    setIsCreating(true)
    setError(null)
    try {
      await onCreate({
        project_id: projectId,
        name,
        client_id: clientId,
        branch: effectiveBranch || null,
        use_worktree: isCreatingNewBranch ? true : useWorktree,
      })
    } catch (err) {
      console.error("Failed to create terminal:", err)
      setError(String(err))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create New Terminal</DialogTitle>
        <DialogDescription>
          Spawn a new AI code agent terminal. Optionally attach it to a specific branch using git worktree.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
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
          {installedClients.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Install Claude Code, OpenCode, or Codex to get started
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="branch">Branch</Label>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                setIsCreatingNewBranch(!isCreatingNewBranch)
                if (!isCreatingNewBranch) {
                  setBranch("")
                } else {
                  setNewBranchName("")
                }
              }}
            >
              {isCreatingNewBranch ? "Select existing branch" : "Create new branch"}
            </button>
          </div>

          {isCreatingNewBranch ? (
            <Input
              id="new-branch"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="feature/my-new-branch"
            />
          ) : (
            <Select
              value={branch || "__default__"}
              onValueChange={(val) => setBranch(val === "__default__" ? "" : val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default (current branch)</SelectItem>
                {branches
                  .filter((b) => !b.is_remote)
                  .map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name} {b.is_current && "(current)"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}

          {isCreatingNewBranch && (
            <p className="text-xs text-muted-foreground">
              A new branch will be created with a git worktree for isolated development
            </p>
          )}
        </div>

        {!isCreatingNewBranch && branch && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="use-worktree">Use Git Worktree</Label>
              <p className="text-xs text-muted-foreground">
                Create an isolated worktree for this branch
              </p>
            </div>
            <Switch id="use-worktree" checked={useWorktree} onCheckedChange={setUseWorktree} />
          </div>
        )}

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
        <Button
          onClick={handleCreate}
          disabled={!name || !clientId || isCreating || (isCreatingNewBranch && !newBranchName)}
        >
          {isCreating ? "Creating..." : "Create Terminal"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
