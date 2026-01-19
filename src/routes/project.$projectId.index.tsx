import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  terminalsQueryOptions,
  projectQueryOptions,
  clientsQueryOptions,
  useUpdateProjectSettings,
} from "@/lib/queries";
import { getLastTerminal } from "@/lib/terminal-history";
import { TerminalStrip } from "@/components/terminal-strip";

export const Route = createFileRoute("/project/$projectId/")({
  loader: async ({ context: { queryClient }, params: { projectId } }) => {
    // Get terminals to find main or first terminal
    const terminals = await queryClient.ensureQueryData(
      terminalsQueryOptions(projectId)
    );

    // Check if we have a saved terminal for this project
    const lastTerminalId = getLastTerminal(projectId);
    if (lastTerminalId && terminals.some((t) => t.id === lastTerminalId)) {
      throw redirect({
        to: "/project/$projectId/$terminalId",
        params: { projectId, terminalId: lastTerminalId },
        replace: true,
      });
    }

    // Fall back to main terminal or first terminal
    const mainTerminal = terminals.find((t) => t.is_main);
    const targetTerminalId = mainTerminal?.id ?? terminals[0]?.id;

    if (targetTerminalId) {
      throw redirect({
        to: "/project/$projectId/$terminalId",
        params: { projectId, terminalId: targetTerminalId },
        replace: true,
      });
    }

    // No terminals exist - load data needed for terminal strip
    await Promise.all([
      queryClient.ensureQueryData(projectQueryOptions(projectId)),
      queryClient.ensureQueryData(clientsQueryOptions()),
    ]);

    return { projectId };
  },
  component: ProjectIndexPage,
});

function ProjectIndexPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();

  // Load data
  const { data: currentProject } = useSuspenseQuery(
    projectQueryOptions(projectId)
  );
  const { data: terminals } = useSuspenseQuery(terminalsQueryOptions(projectId));
  const { data: clients } = useSuspenseQuery(clientsQueryOptions());

  // Mutation for updating settings (backend auto-creates main terminal)
  const updateProjectSettingsMutation = useUpdateProjectSettings();

  // Navigate to main terminal when it appears (created by backend after settings update)
  useEffect(() => {
    const mainTerminal = terminals.find((t) => t.is_main);
    if (mainTerminal) {
      navigate({
        to: "/project/$projectId/$terminalId",
        params: { projectId, terminalId: mainTerminal.id },
        replace: true,
      });
    }
  }, [terminals, projectId, navigate]);

  const handleSelectDefaultClient = (clientId: string) => {
    updateProjectSettingsMutation.mutate({
      project_id: projectId,
      default_client: clientId,
      auto_create_worktree: currentProject.settings.auto_create_worktree,
      worktree_base_path: currentProject.settings.worktree_base_path,
    });
  };

  // This only renders if there are no terminals
  return (
    <div className="flex h-full flex-col">
      {/* Empty state message */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No terminals yet</p>
          <p className="text-xs mt-2">Select a default agent below to get started</p>
        </div>
      </div>

      {/* Terminal Strip with agent selector */}
      <TerminalStrip
        terminals={terminals}
        clients={clients}
        mainTerminal={null}
        activeTerminalId={null}
        defaultClientId={currentProject.settings.default_client}
        onSelectTerminal={() => {}}
        onCloseTerminal={() => {}}
        onRestartTerminal={() => {}}
        onNewTerminal={() => {}}
        onSelectDefaultClient={handleSelectDefaultClient}
      />
    </div>
  );
}
