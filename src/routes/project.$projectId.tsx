import { createFileRoute, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { projectQueryOptions, clientsQueryOptions, useDeleteProject } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Trash2, Home, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

export const Route = createFileRoute("/project/$projectId")({
  loader: async ({ context: { queryClient }, params: { projectId } }) => {
    // Load project and clients data in parallel
    // Errors will propagate to errorComponent for proper handling
    await Promise.all([
      queryClient.ensureQueryData(projectQueryOptions(projectId)),
      queryClient.ensureQueryData(clientsQueryOptions()),
    ]);
  },
  pendingComponent: () => (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-4 animate-spin rounded-full border-4 border-muted border-t-primary h-8 w-8 mx-auto" />
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    </div>
  ),
  errorComponent: ProjectErrorComponent,
  component: ProjectLayout,
});

function ProjectErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const deleteProjectMutation = useDeleteProject();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      // Clear the failed query from cache so it retries fresh
      await queryClient.invalidateQueries({ queryKey: ["projects", "detail", projectId] });
      // Reset the error boundary and re-run the loader
      reset();
      router.invalidate();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDelete = async () => {
    await deleteProjectMutation.mutateAsync(projectId);
    navigate({ to: "/" });
  };

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center max-w-md p-6">
        <div className="text-destructive mb-4">
          <p className="text-lg font-medium">Failed to load project</p>
          <p className="text-sm text-muted-foreground mt-2">{String(error)}</p>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          This can happen if the project path no longer exists or there was an issue with git configuration.
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={handleRetry} disabled={isRetrying}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "Retrying..." : "Retry"}
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            <Home className="mr-2 h-4 w-4" />
            Go Home
          </Button>
          <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        </div>

        <ConfirmationDialog
          open={showDeleteConfirm}
          title="Remove Project"
          description="Remove this project from Ada? Your files on disk won't be deleted."
          confirmText="Remove"
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </div>
    </div>
  );
}

function ProjectLayout() {
  return <Outlet />;
}
