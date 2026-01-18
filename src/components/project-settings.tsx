import { useState, useEffect } from "react"

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
import { projectApi, type UpdateProjectSettingsRequest } from "@/lib/api"
import type { AdaProject, ClientSummary } from "@/lib/types"

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
  open: isOpen,
  onOpenChange,
  onSaved,
}: ProjectSettingsProps) {
  const [defaultClient, setDefaultClient] = useState<string>(
    project.settings.default_client || ""
  )
  const [isSaving, setIsSaving] = useState(false)

  // Reset form when project changes
  useEffect(() => {
    setDefaultClient(project.settings.default_client || "")
  }, [project])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const request: UpdateProjectSettingsRequest = {
        project_id: project.id,
        default_client: defaultClient || null,
        // Preserve existing worktree settings
        auto_create_worktree: project.settings.auto_create_worktree,
        worktree_base_path: project.settings.worktree_base_path,
      }

      const updatedProject = await projectApi.updateSettings(request)
      onSaved(updatedProject)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to save settings:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const installedClients = clients.filter((c) => c.installed)

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Configure settings for {project.name}
          </DialogDescription>
        </DialogHeader>

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
          <div className="grid gap-2">
            <Label htmlFor="default-client">Default AI Client</Label>
            <Select
              value={defaultClient || "__none__"}
              onValueChange={(val) => setDefaultClient(val === "__none__" ? "" : val)}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
