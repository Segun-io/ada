import { useQuery } from "@tanstack/react-query"
import { Terminal, Check, Download, Trash2, AlertCircle } from "lucide-react"
import { cliInstallStatusQuery, useInstallCli, useUninstallCli } from "@/lib/queries/cli"
import { Button } from "@/components/ui/button"

/**
 * CLI Installation Card
 *
 * Shows the installation status of the Ada CLI and allows users
 * to install/uninstall it to their system PATH.
 */
export function CliInstallCard() {
  const { data: status, isLoading } = useQuery(cliInstallStatusQuery)
  const installMutation = useInstallCli()
  const uninstallMutation = useUninstallCli()

  const isInstalling = installMutation.isPending
  const isUninstalling = uninstallMutation.isPending
  const isBusy = isInstalling || isUninstalling
  const canInstall = status?.canInstall ?? false

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Checking CLI status...</span>
        </div>
      </div>
    )
  }

  // Hide completely in dev mode
  if (!canInstall) {
    return null
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">CLI Tool</h3>
            <p className="text-xs text-muted-foreground">
              {status?.installed
                ? status.upToDate
                  ? "Installed and up to date"
                  : "Installed (update available)"
                : "Not installed"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status?.installed ? (
            <>
              <Check className="h-4 w-4 text-green-500" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => uninstallMutation.mutate()}
                disabled={isBusy || !canInstall}
              >
                {isUninstalling ? (
                  "Removing..."
                ) : (
                  <>
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove
                  </>
                )}
              </Button>
              {!status.upToDate && canInstall && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => installMutation.mutate()}
                  disabled={isBusy}
                >
                  {isInstalling ? "Updating..." : "Update"}
                </Button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => installMutation.mutate()}
              disabled={isBusy || !canInstall}
            >
              {isInstalling ? (
                "Installing..."
              ) : (
                <>
                  <Download className="h-3 w-3 mr-1" />
                  Install
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {status?.installed && status.installPath && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 font-mono">
          {status.installPath}
        </div>
      )}

      {(installMutation.isError || uninstallMutation.isError) && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {installMutation.error?.message ||
            uninstallMutation.error?.message ||
            "An error occurred"}
        </div>
      )}

      {!status?.installed && (
        <p className="text-xs text-muted-foreground">
          Install the CLI to use <code className="bg-muted px-1 rounded">ada</code> commands from your terminal.
          You'll be prompted for your password.
        </p>
      )}
    </div>
  )
}
