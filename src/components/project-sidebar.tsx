import { useState, useCallback, useEffect, Suspense } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Plus, FolderOpen, FolderPlus, GitBranch, Bot, ChevronLeft, ChevronRight } from "lucide-react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { readDir, exists } from "@tauri-apps/plugin-fs"
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"

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
import {
  projectsQueryOptions,
  projectQueryOptions,
  terminalsQueryOptions,
  clientsQueryOptions,
  useCreateProject,
  useOpenProject,
  useUpdateProjectSettings,
} from "@/lib/queries"
import { useSidebarCollapsed, useTerminalUIStore } from "@/stores/terminal-ui-store"
import type { ProjectSummary } from "@/lib/types"

export function ProjectSidebar() {
  return (
    <Suspense fallback={<ProjectSidebarSkeleton />}>
      <ProjectSidebarContent />
    </Suspense>
  )
}

function ProjectSidebarSkeleton() {
  const sidebarCollapsed = useSidebarCollapsed()

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

  // Use selectors for minimal re-renders
  const sidebarCollapsed = useSidebarCollapsed()
  const setSidebarCollapsed = useTerminalUIStore((state) => state.setSidebarCollapsed)

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const handleSelectProject = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId } })
  }

  // Prefetch project data on hover for instant navigation
  const handleProjectHover = (projectId: string) => {
    queryClient.prefetchQuery(projectQueryOptions(projectId))
    queryClient.prefetchQuery(terminalsQueryOptions(projectId))
  }

  return (
    <div className={`${sidebarCollapsed ? "w-12" : "w-52"} border-r border-border flex flex-col bg-background transition-all duration-200 select-none`}>
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

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreated={(projectId) => {
          setIsCreateDialogOpen(false)
          navigate({ to: "/project/$projectId", params: { projectId } })
        }}
      />
    </div>
  )
}

interface ProjectItemProps {
  project: ProjectSummary
  isSelected: boolean
  isCollapsed: boolean
  onSelect: () => void
  onHover: () => void
}

function ProjectItem({ project, isSelected, isCollapsed, onSelect, onHover }: ProjectItemProps) {
  if (isCollapsed) {
    return (
      <button
        onClick={onSelect}
        onMouseEnter={onHover}
        className={`w-full flex items-center justify-center py-2 text-sm transition-colors border-b border-border/50 hover:bg-accent/50 cursor-pointer ${
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
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`w-full text-left px-4 py-2 text-sm transition-colors border-b border-border/50 hover:bg-accent/50 truncate cursor-pointer ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      {project.name}
    </button>
  )
}

interface CreateProjectFormValues {
  activeTab: "new" | "existing"
  newPath: string
  initGit: boolean
  existingPath: string
  defaultClient: string
}

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (projectId: string) => void
}

function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  // Path validation state (async validation with Tauri FS APIs)
  const [pathWarning, setPathWarning] = useState<string | null>(null)
  const [isValidatingPath, setIsValidatingPath] = useState(false)

  // Use regular useQuery for dialog content - don't suspend the whole sidebar for this
  const { data: clients = [] } = useQuery(clientsQueryOptions())

  // Mutations
  const createProjectMutation = useCreateProject()
  const openProjectMutation = useOpenProject()
  const updateSettingsMutation = useUpdateProjectSettings()

  // Combined mutation error for display
  const mutationError = createProjectMutation.error || openProjectMutation.error

  const getDefaultValues = useCallback((): CreateProjectFormValues => ({
    activeTab: "new",
    newPath: "",
    initGit: true,
    existingPath: "",
    defaultClient: "",
  }), [])

  // Helper to set default client after project creation/opening
  const applyDefaultClient = async (projectId: string, clientId: string) => {
    try {
      await updateSettingsMutation.mutateAsync({
        project_id: projectId,
        default_client: clientId,
        auto_create_worktree: false,
        worktree_base_path: null,
      })
    } catch {
      // Settings update failed, but we still want to navigate
    }
  }

  const form = useForm({
    defaultValues: getDefaultValues(),
    onSubmit: async ({ value }) => {
      let project
      if (value.activeTab === "new") {
        if (!value.newPath || pathWarning) return
        project = await createProjectMutation.mutateAsync({
          path: value.newPath,
          initGit: value.initGit,
        })
      } else {
        if (!value.existingPath) return
        project = await openProjectMutation.mutateAsync(value.existingPath)
      }

      if (value.defaultClient) {
        await applyDefaultClient(project.id, value.defaultClient)
      }

      onCreated(project.id)
    },
  })

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

  // Reset form and mutations when dialog opens
  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues())
      setPathWarning(null)
      setIsValidatingPath(false)
      // Reset mutations to clear any previous errors
      createProjectMutation.reset()
      openProjectMutation.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when dialog opens
  }, [open])

  // Validate new path with debounce
  useEffect(() => {
    const activeTab = form.state.values.activeTab
    const newPath = form.state.values.newPath

    if (activeTab === "new" && newPath) {
      const timeoutId = setTimeout(() => {
        validateNewPath(newPath)
      }, 300)
      return () => clearTimeout(timeoutId)
    } else {
      setPathWarning(null)
    }
  }, [form.state.values.activeTab, form.state.values.newPath, validateNewPath])

  const handleBrowseNew = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select Location for New Project",
    })

    if (selected) {
      form.setFieldValue("newPath", selected)
    }
  }

  const handleBrowseExisting = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select Folder",
    })

    if (selected) {
      form.setFieldValue("existingPath", selected)
    }
  }

  const isPending = createProjectMutation.isPending || openProjectMutation.isPending || updateSettingsMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Create a new project or open an existing folder.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
        >
          <form.Field name="activeTab">
            {(tabField) => (
              <Tabs
                value={tabField.state.value}
                onValueChange={(v) => {
                  tabField.handleChange(v as "new" | "existing")
                  setPathWarning(null)
                  createProjectMutation.reset()
                  openProjectMutation.reset()
                }}
              >
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
                  <form.Field name="newPath">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor="new-path">Project Location</Label>
                        <div className="flex gap-2">
                          <Input
                            id="new-path"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="/path/to/new-project"
                            className={`flex-1 ${pathWarning ? "border-amber-500" : ""}`}
                          />
                          <Button type="button" variant="outline" onClick={handleBrowseNew}>
                            Browse
                          </Button>
                        </div>
                        {pathWarning && (
                          <p className="text-xs text-amber-600">{pathWarning}</p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="initGit">
                    {(field) => (
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <GitBranch className="h-4 w-4 text-muted-foreground" />
                            <Label htmlFor="init-git" className="font-medium">Initialize Git Repository</Label>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {field.state.value
                              ? "Creates a git repo with an initial commit and worktree support."
                              : "No version control. You can add git later."}
                          </p>
                        </div>
                        <Switch
                          id="init-git"
                          checked={field.state.value}
                          onCheckedChange={field.handleChange}
                        />
                      </div>
                    )}
                  </form.Field>
                </TabsContent>

                <TabsContent value="existing" className="space-y-4 pt-4">
                  <form.Field name="existingPath">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor="existing-path">Folder Location</Label>
                        <div className="flex gap-2">
                          <Input
                            id="existing-path"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="/path/to/existing-folder"
                            className="flex-1"
                          />
                          <Button type="button" variant="outline" onClick={handleBrowseExisting}>
                            Browse
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Opens any folder as a project. If it's a git repository, Ada will configure worktree support automatically.
                        </p>
                      </div>
                    )}
                  </form.Field>
                </TabsContent>
              </Tabs>
            )}
          </form.Field>

          {/* Default AI Client - shared between both tabs */}
          <form.Field name="defaultClient">
            {(field) => (
              <div className="grid gap-2 mt-4">
                <Label htmlFor="default-client">Default AI Client</Label>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id="default-client">
                    <SelectValue placeholder="Select a client (optional)">
                      {field.state.value && (
                        <span className="flex items-center gap-2">
                          <Bot className="h-4 w-4" />
                          {clients.find(c => c.id === field.state.value)?.name}
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
            )}
          </form.Field>

          {mutationError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 mt-4">
              <p className="text-sm text-destructive">{String(mutationError)}</p>
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => ({
                activeTab: state.values.activeTab,
                newPath: state.values.newPath,
                existingPath: state.values.existingPath,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ activeTab, newPath, existingPath, isSubmitting }) => {
                const canSubmit = activeTab === "new"
                  ? newPath && !pathWarning && !isValidatingPath
                  : existingPath

                return (
                  <Button type="submit" disabled={!canSubmit || isSubmitting || isPending}>
                    {isPending
                      ? activeTab === "new" ? "Creating..." : "Opening..."
                      : isValidatingPath
                        ? "Validating..."
                        : activeTab === "new"
                          ? "Create Project"
                          : "Open Project"
                    }
                  </Button>
                )
              }}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
