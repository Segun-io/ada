import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";

export function Router() {
  return <RouterProvider router={router} />;
}
