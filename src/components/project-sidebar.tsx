import { useEffect, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Plus, FolderOpen, Trash2, FolderPlus } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useProjectStore } from "@/stores/project-store"
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

  const handleBrowseAndOpen = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Git Repository",
    })

    if (selected) {
      try {
        const project = await openProject(selected)
        navigate({ to: "/project/$projectId", params: { projectId: project.id } })
      } catch (error) {
        console.error("Failed to open project:", error)
      }
    }
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
              <Button variant="outline" size="sm" onClick={handleBrowseAndOpen}>
                <FolderOpen className="mr-2 h-3 w-3" />
                Open Folder
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
          onClose={() => setIsCreateDialogOpen(false)}
          onCreateNew={async (path) => {
            const project = await createProject(path)
            setIsCreateDialogOpen(false)
            navigate({ to: "/project/$projectId", params: { projectId: project.id } })
          }}
          onOpenExisting={async (path) => {
            const project = await openProject(path)
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
  onClose: () => void
  onCreateNew: (path: string) => Promise<void>
  onOpenExisting: (path: string) => Promise<void>
}

function CreateProjectDialog({ onClose, onCreateNew, onOpenExisting }: CreateProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<"new" | "existing">("new")
  const [newPath, setNewPath] = useState("")
  const [existingPath, setExistingPath] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBrowseNew = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Location for New Project",
    })

    if (selected) {
      // Append a new folder name suggestion
      setNewPath(selected)
    }
  }

  const handleBrowseExisting = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Git Repository",
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
      await onCreateNew(newPath)
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
      await onOpenExisting(existingPath)
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
          Create a new project or open an existing git repository.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "new" | "existing"); setError(null) }}>
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
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowseNew}>
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Creates a new folder with git initialized and an initial commit.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="existing" className="space-y-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="existing-path">Git Repository</Label>
            <div className="flex gap-2">
              <Input
                id="existing-path"
                value={existingPath}
                onChange={(e) => setExistingPath(e.target.value)}
                placeholder="/path/to/existing-repo"
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowseExisting}>
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Opens an existing git repository with at least one commit.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {activeTab === "new" ? (
          <Button onClick={handleCreateNew} disabled={!newPath || isLoading}>
            {isLoading ? "Creating..." : "Create Project"}
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
