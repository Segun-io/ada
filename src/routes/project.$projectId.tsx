import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState, useRef, useCallback } from "react"
import { Plus, Terminal as TerminalIcon, Settings, RefreshCw, Home, FolderOpen, TreeDeciduous } from "lucide-react"
import { listen } from "@tauri-apps/api/event"
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"

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

import { useTerminalUIStore } from "@/stores/terminal-ui-store"
import {
  projectQueryOptions,
  terminalsQueryOptions,
  clientsQueryOptions,
  branchesQueryOptions,
  currentBranchQueryOptions,
  worktreesQueryOptions,
  useCreateTerminal,
  useCreateMainTerminal,
  useCloseTerminal,
  useRestartTerminal,
  useMarkTerminalStopped,
  useSwitchTerminalAgent,
  useUpdateProjectSettings,
} from "@/lib/queries"
import type { BranchInfo, TerminalOutput, WorktreeInfo } from "@/lib/types"
import { TerminalView } from "@/components/terminal-view"
import { TerminalStrip } from "@/components/terminal-strip"
import { ProjectSettings } from "@/components/project-settings"

export const Route = createFileRoute("/project/$projectId")({
  // Prefetch data in the loader
  loader: async ({ context: { queryClient }, params: { projectId } }) => {
    // Prefetch critical data in parallel
    await Promise.all([
      queryClient.ensureQueryData(projectQueryOptions(projectId)),
      queryClient.ensureQueryData(terminalsQueryOptions(projectId)),
      queryClient.ensureQueryData(clientsQueryOptions()),
    ])
  },
  // Show pending component while loading
  pendingComponent: () => (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-4 animate-spin rounded-full border-4 border-muted border-t-primary h-8 w-8 mx-auto" />
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    </div>
  ),
  // Handle errors
  errorComponent: ({ error }) => (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-destructive">
        <p>Failed to load project</p>
        <p className="text-sm text-muted-foreground">{String(error)}</p>
      </div>
    </div>
  ),
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  // TanStack Query with Suspense - data is guaranteed to be available
  const { data: currentProject } = useSuspenseQuery(projectQueryOptions(projectId))
  const { data: terminals } = useSuspenseQuery(terminalsQueryOptions(projectId))
  const { data: clients } = useSuspenseQuery(clientsQueryOptions())

  // Git data - conditional queries (still use useSuspenseQuery but conditionally fetch)
  const isGitRepo = currentProject.is_git_repo
  const { data: currentBranch = "" } = useSuspenseQuery({
    ...currentBranchQueryOptions(projectId),
    queryFn: isGitRepo ? currentBranchQueryOptions(projectId).queryFn : async () => "",
  })
  const { data: worktrees = [] } = useSuspenseQuery({
    ...worktreesQueryOptions(projectId),
    queryFn: isGitRepo ? worktreesQueryOptions(projectId).queryFn : async () => [],
  })
  const { data: branches = [] } = useSuspenseQuery({
    ...branchesQueryOptions(projectId),
    queryFn: isGitRepo ? branchesQueryOptions(projectId).queryFn : async () => [],
  })

  // Mutations
  const createMainTerminalMutation = useCreateMainTerminal()
  const closeTerminalMutation = useCloseTerminal()
  const restartTerminalMutation = useRestartTerminal()
  const markTerminalStoppedMutation = useMarkTerminalStopped()
  const switchTerminalAgentMutation = useSwitchTerminalAgent()
  const updateProjectSettingsMutation = useUpdateProjectSettings()

  // UI state from Zustand
  const {
    activeTerminalId,
    setActiveTerminal,
    initializeTerminals,
    appendOutput,
    loadTerminalHistory,
    getActivity,
    clearTerminalOutput,
    removeTerminal,
    resetActivityToIdle,
  } = useTerminalUIStore()

  const [isCreateTerminalOpen, setIsCreateTerminalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [, setTick] = useState(0)
  const mainTerminalCreatingRef = useRef(false)

  // Find main terminal
  const mainTerminal = terminals.find(t => t.is_main) || null

  // Initialize terminal UI state when terminals change
  useEffect(() => {
    if (terminals.length > 0) {
      const terminalIds = terminals.map(t => t.id)
      const mainId = mainTerminal?.id ?? null
      const lastVisitedId = currentProject.settings.last_visited_terminal_id ?? null
      initializeTerminals(terminalIds, mainId, lastVisitedId)
    }
  }, [terminals, mainTerminal?.id, currentProject.settings.last_visited_terminal_id, initializeTerminals])

  // Debounced persistence of last visited terminal
  const lastVisitedRef = useRef<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistLastVisitedTerminal = useCallback((terminalId: string | null) => {
    if (terminalId === lastVisitedRef.current) return
    lastVisitedRef.current = terminalId

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce the save (1 second)
    saveTimeoutRef.current = setTimeout(() => {
      if (terminalId) {
        updateProjectSettingsMutation.mutate({
          project_id: projectId,
          default_client: currentProject.settings.default_client,
          auto_create_worktree: currentProject.settings.auto_create_worktree,
          worktree_base_path: currentProject.settings.worktree_base_path,
          last_visited_terminal_id: terminalId,
        })
      }
    }, 1000)
  }, [projectId, currentProject.settings, updateProjectSettingsMutation])

  // Track active terminal changes for persistence
  useEffect(() => {
    persistLastVisitedTerminal(activeTerminalId)
  }, [activeTerminalId, persistLastVisitedTerminal])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Auto-create main terminal when default_client is set and no main terminal exists
  useEffect(() => {
    if (
      currentProject.settings.default_client &&
      !mainTerminal &&
      !mainTerminalCreatingRef.current &&
      clients.length > 0 &&
      !createMainTerminalMutation.isPending
    ) {
      const defaultClient = clients.find(c => c.id === currentProject.settings.default_client && c.installed)
      if (defaultClient) {
        mainTerminalCreatingRef.current = true
        createMainTerminalMutation.mutate(
          { projectId, clientId: defaultClient.id },
          {
            onSettled: () => {
              mainTerminalCreatingRef.current = false
            },
            onError: (err) => {
              console.error("Failed to create main terminal:", err)
            },
          }
        )
      }
    }
  }, [currentProject.settings.default_client, mainTerminal, clients, projectId, createMainTerminalMutation])

  // Handle selecting a default client from the terminal strip
  const handleSelectDefaultClient = (clientId: string) => {
    updateProjectSettingsMutation.mutate({
      project_id: projectId,
      default_client: clientId,
      auto_create_worktree: currentProject.settings.auto_create_worktree,
      worktree_base_path: currentProject.settings.worktree_base_path,
    })
  }

  // Handle selecting main terminal
  const handleSelectMainTerminal = () => {
    if (mainTerminal) {
      setActiveTerminal(mainTerminal.id)
    }
  }

  // Handle refreshing project state
  const handleRefreshProject = async () => {
    setIsRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ["projects", "detail", projectId] })
      if (currentProject.is_git_repo) {
        await queryClient.invalidateQueries({ queryKey: ["git", projectId] })
      }
    } catch (err) {
      console.error("Failed to refresh project:", err)
    } finally {
      setIsRefreshing(false)
    }
  }

  // Handle opening new terminal dialog
  const handleNewTerminal = async () => {
    setIsRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ["projects", "detail", projectId] })
    } catch (err) {
      console.error("Failed to refresh project:", err)
    } finally {
      setIsRefreshing(false)
    }
    setIsCreateTerminalOpen(true)
  }

  // Handle close terminal
  const handleCloseTerminal = (terminalId: string) => {
    const terminal = terminals.find(t => t.id === terminalId)
    if (terminal?.is_main) return

    closeTerminalMutation.mutate(
      { terminalId, projectId },
      {
        onSuccess: () => {
          removeTerminal(terminalId, mainTerminal?.id ?? null, terminals.filter(t => t.id !== terminalId).map(t => t.id))
        },
      }
    )
  }

  // Handle restart terminal
  const handleRestartTerminal = (terminalId: string) => {
    restartTerminalMutation.mutate(terminalId, {
      onSuccess: () => {
        resetActivityToIdle(terminalId)
      },
    })
  }

  // Handle switch agent
  const handleSwitchAgent = (terminalId: string, newClientId: string) => {
    switchTerminalAgentMutation.mutate(
      { terminalId, newClientId },
      {
        onSuccess: () => {
          clearTerminalOutput(terminalId)
        },
      }
    )
  }

  // Check if main terminal is active
  const isMainTerminalActive = mainTerminal ? activeTerminalId === mainTerminal.id : false

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
      markTerminalStoppedMutation.mutate(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [markTerminalStoppedMutation])

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

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId)
  const activeActivity = activeTerminalId ? getActivity(activeTerminalId, activeTerminal?.status) : "idle"

  return (
    <div className="flex h-full flex-col">
      {/* Header - Simplified Layout */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        {/* Left: Project Name + Reload */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{currentProject.name}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleRefreshProject}
            disabled={isRefreshing}
            title="Refresh project state"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Center: New Terminal CTA */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleNewTerminal}
          disabled={isRefreshing}
        >
          new code terminal <Plus className="ml-1 h-3 w-3" />
        </Button>

        {/* Right: Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </header>

      {/* Main Terminal View */}
      <div className="flex-1 p-3 min-h-0">
        {activeTerminal ? (
          <TerminalView
            terminalId={activeTerminal.id}
            terminal={activeTerminal}
            activity={activeActivity}
            currentBranch={currentBranch}
            clients={clients.filter(c => c.installed)}
            onRestart={() => handleRestartTerminal(activeTerminal.id)}
            onSwitchAgent={(clientId) => handleSwitchAgent(activeTerminal.id, clientId)}
            onClose={() => handleCloseTerminal(activeTerminal.id)}
          />
        ) : (
          <div className="h-full rounded-xl overflow-hidden bg-[#1a1a1a] border border-border flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <TerminalIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">terminal</p>
              <p className="text-xs mt-2">Select or create a terminal to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Terminal Strip */}
      <TerminalStrip
        terminals={terminals}
        clients={clients}
        activeTerminalId={activeTerminalId}
        mainTerminal={mainTerminal}
        defaultClientId={currentProject.settings.default_client}
        isMainTerminalActive={isMainTerminalActive}
        getActivity={(id) => {
          const terminal = terminals.find(t => t.id === id)
          return getActivity(id, terminal?.status)
        }}
        onSelectTerminal={setActiveTerminal}
        onSelectMainTerminal={handleSelectMainTerminal}
        onCloseTerminal={handleCloseTerminal}
        onRestartTerminal={handleRestartTerminal}
        onNewTerminal={handleNewTerminal}
        onSelectDefaultClient={handleSelectDefaultClient}
      />

      {/* Create Terminal Dialog */}
      <CreateTerminalDialog
        open={isCreateTerminalOpen}
        onOpenChange={setIsCreateTerminalOpen}
        projectId={projectId}
        projectPath={currentProject.path}
        isGitRepo={currentProject.is_git_repo}
        clients={clients}
        defaultClientId={currentProject.settings.default_client}
        existingTerminalNames={terminals.map(t => t.name)}
        worktrees={worktrees}
        branches={branches}
        onCreated={(terminalId) => {
          setActiveTerminal(terminalId)
          setIsCreateTerminalOpen(false)
        }}
      />

      {/* Project Settings Dialog */}
      <ProjectSettings
        project={currentProject}
        clients={clients}
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSaved={async (updatedProject) => {
          // Sync main terminal with new default_client if it changed
          if (mainTerminal && updatedProject.settings.default_client) {
            if (mainTerminal.client_id !== updatedProject.settings.default_client) {
              await handleSwitchAgent(mainTerminal.id, updatedProject.settings.default_client)
            }
          }
        }}
      />
    </div>
  )
}

interface CreateTerminalFormValues {
  name: string
  clientId: string
  mode: "folder" | "current_branch" | "worktree"
  folderPath: string
  selectedWorktree: string
  worktreeMode: "existing" | "new"
  baseBranch: string
  newBranchName: string
}

interface CreateTerminalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectPath: string
  isGitRepo: boolean
  clients: Array<{ id: string; name: string; installed: boolean }>
  defaultClientId: string | null
  existingTerminalNames: string[]
  worktrees: WorktreeInfo[]
  branches: BranchInfo[]
  onCreated: (terminalId: string) => void
}

function CreateTerminalDialog({
  open,
  onOpenChange,
  projectId,
  projectPath,
  isGitRepo,
  clients,
  defaultClientId,
  existingTerminalNames,
  worktrees,
  branches,
  onCreated,
}: CreateTerminalDialogProps) {
  const createTerminalMutation = useCreateTerminal()
  const [error, setError] = useState<string | null>(null)

  const getDefaultValues = useCallback((): CreateTerminalFormValues => ({
    name: "",
    clientId: defaultClientId || "",
    mode: "current_branch",
    folderPath: "",
    selectedWorktree: "",
    worktreeMode: "existing",
    baseBranch: "",
    newBranchName: "",
  }), [defaultClientId])

  const form = useForm({
    defaultValues: getDefaultValues(),
    onSubmit: ({ value }) => {
      const finalName = value.name.trim() || generateDefaultName(value)

      if (existingTerminalNames.includes(finalName)) {
        setError("A terminal with this name already exists")
        return
      }

      let worktreeBranch: string | null = null
      if (value.mode === "worktree") {
        if (value.worktreeMode === "existing") {
          const wt = worktrees.find(w => w.path === value.selectedWorktree)
          worktreeBranch = wt?.branch || null
        } else {
          worktreeBranch = `wt-${value.baseBranch}/${value.newBranchName}`
        }
      }

      setError(null)
      createTerminalMutation.mutate(
        {
          project_id: projectId,
          name: finalName,
          client_id: value.clientId,
          mode: value.mode,
          folder_path: value.mode === "folder" ? value.folderPath : null,
          worktree_branch: worktreeBranch,
        },
        {
          onSuccess: (newTerminal) => {
            onCreated(newTerminal.id)
          },
          onError: (err) => {
            console.error("Failed to create terminal:", err)
            setError(String(err))
          },
        }
      )
    },
  })

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues())
      setError(null)
    }
  }, [open, form, getDefaultValues])

  const installedClients = clients.filter((c) => c.installed)

  // Generate default terminal name based on mode
  const generateDefaultName = (values: CreateTerminalFormValues) => {
    let baseName: string

    switch (values.mode) {
      case "current_branch":
        baseName = "main"
        break
      case "folder":
        if (values.folderPath) {
          const segments = values.folderPath.split("/").filter(Boolean)
          baseName = segments[segments.length - 1] || "folder"
        } else {
          baseName = "folder"
        }
        break
      case "worktree":
        if (values.worktreeMode === "existing" && values.selectedWorktree) {
          const wt = worktrees.find(w => w.path === values.selectedWorktree)
          if (wt?.branch) {
            const segments = wt.branch.split("/").filter(Boolean)
            baseName = segments[segments.length - 1] || "worktree"
          } else {
            baseName = "worktree"
          }
        } else if (values.worktreeMode === "new" && values.newBranchName) {
          const segments = values.newBranchName.split("/").filter(Boolean)
          baseName = segments[segments.length - 1] || "worktree"
        } else {
          baseName = "worktree"
        }
        break
      default:
        baseName = "terminal"
    }

    baseName = baseName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")

    let counter = 1
    let candidateName = `${baseName}-${counter}`
    while (existingTerminalNames.includes(candidateName)) {
      counter++
      candidateName = `${baseName}-${counter}`
    }
    return candidateName
  }

  const handleBrowseFolder = async () => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog")
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: projectPath,
      title: "Select Folder",
    })

    if (selected) {
      if (selected.startsWith(projectPath)) {
        const relativePath = selected.slice(projectPath.length).replace(/^[/\\]/, "")
        form.setFieldValue("folderPath", relativePath || ".")
      } else {
        setError("Please select a folder within the project directory")
      }
    }
  }

  const inputProps = {
    autoComplete: "off",
    autoCorrect: "off",
    spellCheck: false,
    autoCapitalize: "off",
  } as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Terminal</DialogTitle>
          <DialogDescription>
            Spawn a new AI code agent terminal with a specific mode.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
        >
          <div className="grid gap-4 py-4">
            {/* Terminal Name (optional) */}
            <form.Field name="name">
              {(field) => {
                const nameError = field.state.value && existingTerminalNames.includes(field.state.value)
                  ? "A terminal with this name already exists"
                  : null
                return (
                  <div className="grid gap-2">
                    <Label htmlFor="terminal-name">Terminal Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input
                      id="terminal-name"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder={generateDefaultName(form.state.values)}
                      className={nameError ? "border-destructive" : ""}
                      {...inputProps}
                    />
                    {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                  </div>
                )
              }}
            </form.Field>

            {/* AI Client */}
            <form.Field name="clientId">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="client">AI Client</Label>
                  <Select value={field.state.value} onValueChange={field.handleChange}>
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
              )}
            </form.Field>

            {/* Mode selection tabs */}
            <form.Field name="mode">
              {(modeField) => (
                <div className="grid gap-2">
                  <Label>Terminal Mode</Label>
                  <Tabs
                    value={modeField.state.value}
                    onValueChange={(v) => {
                      modeField.handleChange(v as typeof modeField.state.value)
                      setError(null)
                    }}
                  >
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
                      <form.Field name="folderPath">
                        {(field) => (
                          <>
                            <Label htmlFor="folder-path">Folder Path</Label>
                            <div className="flex gap-2">
                              <Input
                                id="folder-path"
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                                placeholder="src/components"
                                className="flex-1"
                                {...inputProps}
                              />
                              <Button type="button" variant="outline" onClick={handleBrowseFolder}>
                                Browse
                              </Button>
                            </div>
                          </>
                        )}
                      </form.Field>
                      <p className="text-xs text-muted-foreground">
                        Runs in a subfolder of the project.
                      </p>
                    </TabsContent>

                    {isGitRepo && (
                      <TabsContent value="worktree" className="mt-3 space-y-3">
                        {/* Worktree mode toggle */}
                        <form.Field name="worktreeMode">
                          {(worktreeModeField) => (
                            <Tabs
                              value={worktreeModeField.state.value}
                              onValueChange={(v) => {
                                worktreeModeField.handleChange(v as typeof worktreeModeField.state.value)
                                setError(null)
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
                                  <form.Field name="selectedWorktree">
                                    {(field) => (
                                      <>
                                        <Label>Select Worktree</Label>
                                        <Select value={field.state.value} onValueChange={field.handleChange}>
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
                                  </form.Field>
                                )}
                              </TabsContent>

                              <TabsContent value="new" className="mt-2 space-y-2">
                                <form.Field name="baseBranch">
                                  {(field) => (
                                    <div className="space-y-1">
                                      <Label>Base Branch</Label>
                                      {branches.filter(b => !b.is_remote).length === 0 ? (
                                        <p className="text-xs text-muted-foreground py-2">
                                          No local branches available.
                                        </p>
                                      ) : (
                                        <Select value={field.state.value} onValueChange={field.handleChange}>
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
                                  )}
                                </form.Field>

                                <form.Field name="newBranchName">
                                  {(field) => (
                                    <div className="space-y-1">
                                      <Label>New Branch Name</Label>
                                      <Input
                                        value={field.state.value}
                                        onChange={(e) => field.handleChange(e.target.value.replace(/\s+/g, "-"))}
                                        onBlur={field.handleBlur}
                                        placeholder="feature/my-feature"
                                        {...inputProps}
                                      />
                                    </div>
                                  )}
                                </form.Field>

                                <form.Subscribe
                                  selector={(state) => ({
                                    baseBranch: state.values.baseBranch,
                                    newBranchName: state.values.newBranchName,
                                  })}
                                >
                                  {({ baseBranch, newBranchName }) =>
                                    baseBranch && newBranchName ? (
                                      <div className="rounded-md bg-muted p-2 space-y-1">
                                        <p className="text-xs font-medium">Worktree will be created:</p>
                                        <code className="text-xs block break-all">
                                          wt-{baseBranch}/{newBranchName}
                                        </code>
                                        <p className="text-[10px] text-muted-foreground">
                                          Branch <span className="font-mono">{newBranchName}</span> from <span className="font-mono">{baseBranch}</span>
                                        </p>
                                      </div>
                                    ) : null
                                  }
                                </form.Subscribe>
                              </TabsContent>
                            </Tabs>
                          )}
                        </form.Field>
                      </TabsContent>
                    )}
                  </Tabs>
                </div>
              )}
            </form.Field>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => {
                const values = state.values
                const nameConflict = values.name && existingTerminalNames.includes(values.name)
                const isValid = values.clientId && !nameConflict && (
                  values.mode === "current_branch" ||
                  (values.mode === "folder" && values.folderPath) ||
                  (values.mode === "worktree" && (
                    (values.worktreeMode === "existing" && values.selectedWorktree) ||
                    (values.worktreeMode === "new" && values.baseBranch && values.newBranchName)
                  ))
                )
                return { canSubmit: isValid, isSubmitting: state.isSubmitting }
              }}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting || createTerminalMutation.isPending}>
                  {isSubmitting || createTerminalMutation.isPending ? "Creating..." : "Create Terminal"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
