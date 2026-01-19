import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useTauriEvents } from "@/lib/tauri-events";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectSidebar } from "@/components/project-sidebar";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const { queryClient } = Route.useRouteContext();
  useTauriEvents(queryClient);

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground dark flex">
        {/* Left Sidebar - Project List */}
        <ProjectSidebar />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
