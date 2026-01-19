import { createFileRoute, redirect } from "@tanstack/react-router";
import { terminalsQueryOptions } from "@/lib/queries";
import { getLastTerminal } from "@/lib/terminal-history";

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

    // No terminals exist - stay on index (will show empty state)
    return { projectId };
  },
  component: ProjectIndexPage,
});

function ProjectIndexPage() {
  // This only renders if there are no terminals
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-muted-foreground">
        <p className="text-sm">No terminals yet</p>
        <p className="text-xs mt-2">Select a default agent to get started</p>
      </div>
    </div>
  );
}
