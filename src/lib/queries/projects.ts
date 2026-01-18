import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { projectApi, type UpdateProjectSettingsRequest } from "../api"
import { queryKeys } from "../query-client"

// Query Options
export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.projects.list(),
    queryFn: () => projectApi.list(),
  })

export const projectQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => projectApi.get(projectId),
    enabled: !!projectId,
  })

// Mutations
export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ path, initGit = true }: { path: string; initGit?: boolean }) =>
      projectApi.create(path, initGit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
  })
}

export function useOpenProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (path: string) => projectApi.open(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) => projectApi.delete(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
  })
}

export function useUpdateProjectSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: UpdateProjectSettingsRequest) =>
      projectApi.updateSettings(request),
    onSuccess: (updatedProject) => {
      queryClient.setQueryData(
        queryKeys.projects.detail(updatedProject.id),
        updatedProject
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() })
    },
  })
}
