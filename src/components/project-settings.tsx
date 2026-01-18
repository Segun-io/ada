import { useEffect, useCallback } from "react"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useUpdateProjectSettings } from "@/lib/queries"
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
}

export function ProjectSettings({
  project,
  clients,
  open,
  onOpenChange,
  onSaved,
}: ProjectSettingsProps) {
  const updateSettingsMutation = useUpdateProjectSettings()

  const getDefaultValues = useCallback((): ProjectSettingsFormValues => ({
    defaultClient: project.settings.default_client || "",
  }), [project.settings.default_client])

  const form = useForm({
    defaultValues: getDefaultValues(),
    onSubmit: ({ value }) => {
      updateSettingsMutation.mutate(
        {
          project_id: project.id,
          default_client: value.defaultClient || null,
          auto_create_worktree: project.settings.auto_create_worktree,
          worktree_base_path: project.settings.worktree_base_path,
        },
        {
          onSuccess: (updatedProject) => {
            onSaved(updatedProject)
            onOpenChange(false)
          },
          onError: (error) => {
            console.error("Failed to save settings:", error)
          },
        }
      )
    },
  })

  // Reset form when dialog opens or project changes
  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues())
    }
  }, [open, form, getDefaultValues])

  const installedClients = clients.filter((c) => c.installed)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
      </DialogContent>
    </Dialog>
  )
}
