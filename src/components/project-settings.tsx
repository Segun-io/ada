import { useCallback, useState, useRef, useEffect } from "react"
import { useForm } from "@tanstack/react-form"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { useUpdateProjectSettings, useDeleteProject } from "@/lib/queries"
import type { AdaProject, ClientSummary } from "@/lib/types"

interface ProjectSettingsFormValues {
  defaultClient: string
}

interface ProjectSettingsProps {
  project: AdaProject
  clients: ClientSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (project: AdaProject) => void
  onDeleted: () => void
}

export function ProjectSettings({
  project,
  clients,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: ProjectSettingsProps) {
  const updateSettingsMutation = useUpdateProjectSettings()
  const deleteProjectMutation = useDeleteProject()
  const [deleteConfirmation, setDeleteConfirmation] = useState(false)

  const wasOpenRef = useRef(false)

  const getDefaultValues = useCallback((): ProjectSettingsFormValues => ({
    defaultClient: project.settings.default_client || "",
  }), [project.settings.default_client])

  const form = useForm({
    defaultValues: getDefaultValues(),
    onSubmit: async ({ value }) => {
      const updatedProject = await updateSettingsMutation.mutateAsync({
        project_id: project.id,
        default_client: value.defaultClient || null,
        auto_create_worktree: project.settings.auto_create_worktree,
        worktree_base_path: project.settings.worktree_base_path,
      })
      onSaved(updatedProject)
      onOpenChange(false)
    },
  })

  // Reset form when dialog transitions from closed to open
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      form.reset(getDefaultValues())
      updateSettingsMutation.reset()
      deleteProjectMutation.reset()
    }
    wasOpenRef.current = open
  }, [open, form, getDefaultValues, updateSettingsMutation, deleteProjectMutation])

  // Wrap onOpenChange to reset delete confirmation when closing
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setDeleteConfirmation(false)
    }
    onOpenChange(isOpen)
  }

  const handleDelete = async () => {
    await deleteProjectMutation.mutateAsync(project.id)
    onOpenChange(false)
    onDeleted()
  }

  const installedClients = clients.filter((c) => c.installed)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Configure settings for {project.name}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
        >
          <div className="grid gap-6 py-4">
            {/* Project Info */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Project Information</h3>
              <div className="text-sm text-muted-foreground">
                <p><span className="font-medium">Name:</span> {project.name}</p>
                <p className="truncate"><span className="font-medium">Path:</span> {project.path}</p>
              </div>
            </div>

            {/* Default Client */}
            <form.Field name="defaultClient">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="default-client">Default AI Client</Label>
                  <Select
                    value={field.state.value || "__none__"}
                    onValueChange={(val) => field.handleChange(val === "__none__" ? "" : val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select default client" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (ask each time)</SelectItem>
                      {installedClients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Pre-select this client when creating new terminals
                  </p>
                </div>
              )}
            </form.Field>

            {/* Worktree Base Path (read-only) */}
            {project.is_git_repo && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Worktree Directory</Label>
                <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md truncate">
                  {project.settings.worktree_base_path || `${project.path}/.worktrees`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Where git worktrees are created for branch-specific terminals
                </p>
              </div>
            )}

            {/* Error Display */}
            {(updateSettingsMutation.error || deleteProjectMutation.error) && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                <p className="text-sm text-destructive">
                  {String(updateSettingsMutation.error || deleteProjectMutation.error)}
                </p>
              </div>
            )}

            {/* Danger Zone */}
            <div className="border-t border-destructive/20 pt-4 mt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-destructive">Delete Project</h3>
                  <p className="text-xs text-muted-foreground">
                    Remove from Ada. Files on disk won't be deleted.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteConfirmation(true)}
                  disabled={deleteProjectMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting || updateSettingsMutation.isPending}>
                  {isSubmitting || updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          open={deleteConfirmation}
          title="Delete Project"
          description={`Are you sure you want to delete "${project.name}"? This will remove it from Ada but won't delete any files on disk.`}
          confirmText="Delete"
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmation(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
