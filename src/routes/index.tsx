import { createFileRoute } from "@tanstack/react-router"
import { Terminal } from "lucide-react"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center p-8">
      <Terminal className="h-16 w-16 text-muted-foreground/30 mb-6" />
      <h1 className="text-2xl font-semibold mb-2">Welcome to Ada</h1>
      <p className="text-muted-foreground max-w-md">
        Select a project from the sidebar or create a new one to start managing your AI code agents.
      </p>
    </div>
  )
}
