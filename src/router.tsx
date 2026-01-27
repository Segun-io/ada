import { RouterProvider } from "@tanstack/react-router"
import { router } from "./lib/router-instance"

export function Router() {
  return <RouterProvider router={router} />
}
