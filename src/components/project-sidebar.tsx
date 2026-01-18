import { useEffect, useState, useCallback } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Plus, FolderOpen, Trash2, FolderPlus, GitBranch, Bot } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { readDir, exists } from "@tauri-apps/plugin-fs"

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
import { useProjectStore } from "@/stores/project-store"
import { useClientStore } from "@/stores/client-store"
import { projectApi } from "@/lib/api"
import type { ProjectSummary } from "@/lib/types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ProjectSidebar() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const currentProjectId = (params as { projectId?: string }).projectId

  const { projects, loadProjects, createProject, openProject, deleteProject } = useProjectStore()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleSelectProject = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId } })
  }

  return (
    <div className="w-52 border-r border-border flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-lg">ada</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setIsCreateDialogOpen(true)}
        >
          new project <Plus className="ml-1 h-3 w-3" />
        </Button>
      </div>

      {/* Project List */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {projects.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <p className="mb-3">No projects yet</p>
              <Button variant="outline" size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-3 w-3" />
                Add Project
              </Button>
            </div>
          ) : (
            projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isSelected={project.id === currentProjectId}
                onSelect={() => handleSelectProject(project.id)}
                onDelete={() => deleteProject(project.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Create Project Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <CreateProjectDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onCreateNew={async (path, initGit, defaultClientId) => {
            const project = await createProject(path, initGit)
            // Update default client setting if selected
            if (defaultClientId) {
              await projectApi.updateSettings({
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
            const project = await openProject(path)
            // Update default client setting if selected
            if (defaultClientId) {
              await projectApi.updateSettings({
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
  onSelect: () => void
  onDelete: () => void
}

function ProjectItem({ project, isSelected, onSelect, onDelete }: ProjectItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onSelect}
          className={`w-full text-left px-4 py-2 text-sm transition-colors border-b border-border/50 hover:bg-accent/50 ${
            isSelected ? "bg-accent" : ""
          }`}
        >
          {project.name}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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

  const { clients, loadClients } = useClientStore()

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
      }, 300) // Debounce validation
      return () => clearTimeout(timeoutId)
    } else {
      setPathWarning(null)
    }
  }, [newPath, activeTab, validateNewPath])

  // Reset state and load clients when dialog opens
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
      loadClients()
    }
  }, [isOpen, loadClients])

  // Reset state when dialog closes
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
