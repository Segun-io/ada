import { createFileRoute, Outlet } from "@tanstack/react-router";
import { projectQueryOptions, clientsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/project/$projectId")({
  loader: async ({ context: { queryClient }, params: { projectId } }) => {
    // Prefetch project and clients for all child routes
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
  errorComponent: ({ error }) => (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-destructive">
        <p>Failed to load project</p>
        <p className="text-sm text-muted-foreground">{String(error)}</p>
      </div>
    </div>
  ),
  component: ProjectLayout,
});

function ProjectLayout() {
  return <Outlet />;
}
