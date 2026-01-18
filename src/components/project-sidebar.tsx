import { useState, useCallback, useEffect, Suspense } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Plus, FolderOpen, Trash2, FolderPlus, GitBranch, Bot, ChevronLeft, ChevronRight } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { readDir, exists } from "@tauri-apps/plugin-fs"
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import {
  projectsQueryOptions,
  projectQueryOptions,
  terminalsQueryOptions,
  clientsQueryOptions,
  useCreateProject,
  useOpenProject,
  useDeleteProject,
  useUpdateProjectSettings,
} from "@/lib/queries"
import { useTerminalUIStore } from "@/stores/terminal-ui-store"
import type { ProjectSummary } from "@/lib/types"

export function ProjectSidebar() {
  return (
    <Suspense fallback={<ProjectSidebarSkeleton />}>
      <ProjectSidebarContent />
    </Suspense>
  )
}

function ProjectSidebarSkeleton() {
  const { sidebarCollapsed } = useTerminalUIStore()

  return (
    <div className={`${sidebarCollapsed ? "w-12" : "w-52"} border-r border-border flex flex-col bg-background transition-all duration-200`}>
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        {!sidebarCollapsed && <span className="font-semibold text-lg">ada</span>}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full border-2 border-muted border-t-primary h-6 w-6" />
      </div>
    </div>
  )
}

function ProjectSidebarContent() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const currentProjectId = (params as { projectId?: string }).projectId

  const { data: projects } = useSuspenseQuery(projectsQueryOptions())
  const createProjectMutation = useCreateProject()
  const openProjectMutation = useOpenProject()
  const deleteProjectMutation = useDeleteProject()
  const updateSettingsMutation = useUpdateProjectSettings()

  const { sidebarCollapsed, setSidebarCollapsed } = useTerminalUIStore()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; projectId: string; projectName: string }>({
    open: false,
    projectId: "",
    projectName: "",
  })

  const handleSelectProject = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId } })
  }

  // Prefetch project data on hover for instant navigation
  const handleProjectHover = (projectId: string) => {
    queryClient.prefetchQuery(projectQueryOptions(projectId))
    queryClient.prefetchQuery(terminalsQueryOptions(projectId))
  }

  const handleDeleteProject = async (projectId: string) => {
    await deleteProjectMutation.mutateAsync(projectId)
    if (projectId === currentProjectId) {
      navigate({ to: "/" })
    }
  }

  const handleDeleteClick = (project: ProjectSummary, shiftKey: boolean) => {
    if (shiftKey) {
      // Shift+click bypasses confirmation
      handleDeleteProject(project.id)
    } else {
      // Show confirmation dialog
      setDeleteConfirmation({
        open: true,
        projectId: project.id,
        projectName: project.name,
      })
    }
  }

  const confirmDelete = () => {
    handleDeleteProject(deleteConfirmation.projectId)
    setDeleteConfirmation({ open: false, projectId: "", projectName: "" })
  }

  const cancelDelete = () => {
    setDeleteConfirmation({ open: false, projectId: "", projectName: "" })
  }

  return (
    <div className={`${sidebarCollapsed ? "w-12" : "w-52"} border-r border-border flex flex-col bg-background transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        {!sidebarCollapsed && <span className="font-semibold text-lg">ada</span>}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Project List */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {projects.length === 0 ? (
            <div className={`${sidebarCollapsed ? "px-2" : "px-4"} py-8 text-center text-sm text-muted-foreground`}>
              {!sidebarCollapsed && <p className="mb-3">No projects yet</p>}
              <Button
                variant="outline"
                size={sidebarCollapsed ? "icon" : "sm"}
                onClick={() => setIsCreateDialogOpen(true)}
                className={sidebarCollapsed ? "h-8 w-8" : ""}
              >
                <Plus className={sidebarCollapsed ? "h-4 w-4" : "mr-2 h-3 w-3"} />
                {!sidebarCollapsed && "Add Project"}
              </Button>
            </div>
          ) : (
            projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isSelected={project.id === currentProjectId}
                isCollapsed={sidebarCollapsed}
                onSelect={() => handleSelectProject(project.id)}
                onHover={() => handleProjectHover(project.id)}
                onDelete={(shiftKey) => handleDeleteClick(project, shiftKey)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add Project Button - Footer */}
      {projects.length > 0 && (
        <div className={`border-t border-border ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          <Button
            variant="ghost"
            size={sidebarCollapsed ? "icon" : "sm"}
            className={`${sidebarCollapsed ? "h-8 w-8" : "w-full justify-start"}`}
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className={sidebarCollapsed ? "h-4 w-4" : "mr-2 h-3 w-3"} />
            {!sidebarCollapsed && "new project"}
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={deleteConfirmation.open}
        title="Delete Project"
        description={`Are you sure you want to delete "${deleteConfirmation.projectName}"? This will remove it from Ada but won't delete any files on disk.`}
        confirmText="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      {/* Create Project Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <CreateProjectDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onCreateNew={async (path, initGit, defaultClientId) => {
            const project = await createProjectMutation.mutateAsync({ path, initGit })
            if (defaultClientId) {
              await updateSettingsMutation.mutateAsync({
                project_id: project.id,
                default_client: defaultClientId,
                auto_create_worktree: false,
                worktree_base_path: null,
              })
            }
            setIsCreateDialogOpen(false)
            navigate({ to: "/project/$projectId", params: { projectId: project.id } })
          }}
          onOpenExisting={async (path, defaultClientId) => {
            const project = await openProjectMutation.mutateAsync(path)
            if (defaultClientId) {
              await updateSettingsMutation.mutateAsync({
                project_id: project.id,
                default_client: defaultClientId,
                auto_create_worktree: false,
                worktree_base_path: null,
              })
            }
            setIsCreateDialogOpen(false)
            navigate({ to: "/project/$projectId", params: { projectId: project.id } })
          }}
        />
      </Dialog>
    </div>
  )
}

interface ProjectItemProps {
  project: ProjectSummary
  isSelected: boolean
  isCollapsed: boolean
  onSelect: () => void
  onHover: () => void
  onDelete: (shiftKey: boolean) => void
}

function ProjectItem({ project, isSelected, isCollapsed, onSelect, onHover, onDelete }: ProjectItemProps) {
  if (isCollapsed) {
    return (
      <button
        onClick={onSelect}
        onMouseEnter={onHover}
        className={`group w-full flex items-center justify-center py-2 text-sm transition-colors border-b border-border/50 hover:bg-accent/50 ${
          isSelected ? "bg-accent" : ""
        }`}
        title={project.name}
      >
        <span className="w-6 h-6 rounded bg-muted flex items-center justify-center text-xs font-medium">
          {project.name.charAt(0).toUpperCase()}
        </span>
      </button>
    )
  }

  return (
    <div
      className={`group relative w-full flex items-center text-left px-4 py-2 text-sm transition-colors border-b border-border/50 hover:bg-accent/50 ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <button
        onClick={onSelect}
        onMouseEnter={onHover}
        className="flex-1 text-left truncate"
      >
        {project.name}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(e.shiftKey)
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
        title="Delete project (Shift+click to skip confirmation)"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface CreateProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreateNew: (path: string, initGit: boolean, defaultClientId: string | null) => Promise<void>
  onOpenExisting: (path: string, defaultClientId: string | null) => Promise<void>
}

function CreateProjectDialog({ isOpen, onClose, onCreateNew, onOpenExisting }: CreateProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<"new" | "existing">("new")
  const [newPath, setNewPath] = useState("")
  const [initGit, setInitGit] = useState(true)
  const [existingPath, setExistingPath] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [defaultClient, setDefaultClient] = useState<string>("")
  const [pathWarning, setPathWarning] = useState<string | null>(null)
  const [isValidatingPath, setIsValidatingPath] = useState(false)

  // Use regular useQuery for dialog content - don't suspend the whole sidebar for this
  const { data: clients = [] } = useQuery(clientsQueryOptions())

  // Validate that the folder is empty or doesn't exist
  const validateNewPath = useCallback(async (path: string) => {
    if (!path) {
      setPathWarning(null)
      return
    }

    setIsValidatingPath(true)
    setPathWarning(null)

    try {
      const pathExists = await exists(path)
      if (pathExists) {
        const entries = await readDir(path)
        if (entries.length > 0) {
          setPathWarning("This folder is not empty. Please choose an empty folder or a new location.")
        }
      }
    } catch {
      // Path doesn't exist or can't be read - that's fine for new projects
    } finally {
      setIsValidatingPath(false)
    }
  }, [])

  // Validate path when it changes
  useEffect(() => {
    if (activeTab === "new" && newPath) {
      const timeoutId = setTimeout(() => {
        validateNewPath(newPath)
      }, 300)
      return () => clearTimeout(timeoutId)
    } else {
      setPathWarning(null)
    }
  }, [newPath, activeTab, validateNewPath])

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab("new")
      setNewPath("")
      setInitGit(true)
      setExistingPath("")
      setError(null)
      setIsLoading(false)
      setDefaultClient("")
      setPathWarning(null)
      setIsValidatingPath(false)
    }
  }, [isOpen])

  const handleClose = () => {
    setActiveTab("new")
    setNewPath("")
    setInitGit(true)
    setExistingPath("")
    setError(null)
    setDefaultClient("")
    setPathWarning(null)
    onClose()
  }

  const handleBrowseNew = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Location for New Project",
    })

    if (selected) {
      setNewPath(selected)
    }
  }

  const handleBrowseExisting = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Folder",
    })

    if (selected) {
      setExistingPath(selected)
    }
  }

  const handleCreateNew = async () => {
    if (!newPath) return
    setIsLoading(true)
    setError(null)
    try {
      await onCreateNew(newPath, initGit, defaultClient || null)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenExisting = async () => {
    if (!existingPath) return
    setIsLoading(true)
    setError(null)
    try {
      await onOpenExisting(existingPath, defaultClient || null)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add Project</DialogTitle>
        <DialogDescription>
          Create a new project or open an existing folder.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "new" | "existing"); setError(null); setPathWarning(null) }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="new" className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4" />
            New Project
          </TabsTrigger>
          <TabsTrigger value="existing" className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Open Existing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="new-path">Project Location</Label>
            <div className="flex gap-2">
              <Input
                id="new-path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/path/to/new-project"
                className={`flex-1 ${pathWarning ? "border-amber-500" : ""}`}
              />
              <Button variant="outline" onClick={handleBrowseNew}>
                Browse
              </Button>
            </div>
            {pathWarning && (
              <p className="text-xs text-amber-600">{pathWarning}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="init-git" className="font-medium">Initialize Git Repository</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {initGit
                  ? "Creates a git repo with an initial commit and worktree support."
                  : "No version control. You can add git later."}
              </p>
            </div>
            <Switch id="init-git" checked={initGit} onCheckedChange={setInitGit} />
          </div>
        </TabsContent>

        <TabsContent value="existing" className="space-y-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="existing-path">Folder Location</Label>
            <div className="flex gap-2">
              <Input
                id="existing-path"
                value={existingPath}
                onChange={(e) => setExistingPath(e.target.value)}
                placeholder="/path/to/existing-folder"
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowseExisting}>
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Opens any folder as a project. If it's a git repository, Ada will configure worktree support automatically.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Default AI Client - shared between both tabs */}
      <div className="grid gap-2">
        <Label htmlFor="default-client">Default AI Client</Label>
        <Select value={defaultClient} onValueChange={setDefaultClient}>
          <SelectTrigger id="default-client">
            <SelectValue placeholder="Select a client (optional)">
              {defaultClient && (
                <span className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  {clients.find(c => c.id === defaultClient)?.name}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {clients.filter(c => c.installed).map((client) => (
              <SelectItem key={client.id} value={client.id}>
                <span className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  {client.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The AI client to use when creating new terminals in this project.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={handleClose}>
          Cancel
        </Button>
        {activeTab === "new" ? (
          <Button onClick={handleCreateNew} disabled={!newPath || isLoading || !!pathWarning || isValidatingPath}>
            {isLoading ? "Creating..." : isValidatingPath ? "Validating..." : "Create Project"}
          </Button>
        ) : (
          <Button onClick={handleOpenExisting} disabled={!existingPath || isLoading}>
            {isLoading ? "Opening..." : "Open Project"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
