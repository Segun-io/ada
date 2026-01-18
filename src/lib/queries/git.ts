import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { gitApi } from "../api"
import { queryKeys } from "../query-client"

// Query Options
export const branchesQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.git.branches(projectId),
    queryFn: () => gitApi.getBranches(projectId),
    enabled: !!projectId,
  })

export const currentBranchQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.git.currentBranch(projectId),
    queryFn: () => gitApi.getCurrentBranch(projectId),
    enabled: !!projectId,
  })

export const worktreesQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.git.worktrees(projectId),
    queryFn: () => gitApi.listWorktrees(projectId),
    enabled: !!projectId,
  })

// Mutations
export function useCreateWorktree() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      projectId,
      branch,
      worktreePath,
    }: {
      projectId: string
      branch: string
      worktreePath?: string
    }) => gitApi.createWorktree(projectId, branch, worktreePath),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.git.worktrees(projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.git.branches(projectId),
      })
    },
  })
}

export function useRemoveWorktree() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, worktreePath }: { projectId: string; worktreePath: string }) =>
      gitApi.removeWorktree(projectId, worktreePath),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.git.worktrees(projectId),
      })
    },
  })
}
