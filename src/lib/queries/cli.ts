import { invoke } from "@tauri-apps/api/core"
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { CliInstallStatus } from "@/lib/types"

/**
 * Query to check CLI installation status
 */
export const cliInstallStatusQuery = queryOptions({
  queryKey: ["cli", "installStatus"],
  queryFn: () => invoke<CliInstallStatus>("check_cli_installed"),
  staleTime: 10000, // Cache for 10 seconds
})

/**
 * Mutation to install CLI to PATH
 */
export function useInstallCli() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => invoke<CliInstallStatus>("install_cli"),
    onSuccess: (data) => {
      // Update the cache with new status
      queryClient.setQueryData(["cli", "installStatus"], data)
    },
  })
}

/**
 * Mutation to uninstall CLI from PATH
 */
export function useUninstallCli() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => invoke<CliInstallStatus>("uninstall_cli"),
    onSuccess: (data) => {
      // Update the cache with new status
      queryClient.setQueryData(["cli", "installStatus"], data)
    },
  })
}
