import { createRouter } from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { routeTree } from "../routeTree.gen"
import { queryClient } from "./query-client"

// Create router context type
export interface RouterContext {
  queryClient: QueryClient
}

// Create a new router instance
export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0, // Pass all preload events to TanStack Query
})

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
