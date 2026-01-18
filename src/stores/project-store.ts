import { create } from "zustand"
import type { AdaProject, ProjectSummary } from "@/lib/types"
import { projectApi } from "@/lib/api"

interface ProjectState {
  projects: ProjectSummary[]
  currentProject: AdaProject | null
  isLoading: boolean
  error: string | null

  // Actions
  loadProjects: () => Promise<void>
  loadProject: (projectId: string) => Promise<void>
  createProject: (path: string) => Promise<AdaProject>
  openProject: (path: string) => Promise<AdaProject>
  deleteProject: (projectId: string) => Promise<void>
  setCurrentProject: (project: AdaProject | null) => void
  clearError: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const projects = await projectApi.list()
      set({ projects, isLoading: false })
    } catch (error) {
      set({ error: String(error), isLoading: false })
    }
  },

  loadProject: async (projectId: string) => {
    set({ isLoading: true, error: null })
    try {
      const project = await projectApi.get(projectId)
      set({ currentProject: project, isLoading: false })
    } catch (error) {
      set({ error: String(error), isLoading: false })
    }
  },

  createProject: async (path) => {
    set({ isLoading: true, error: null })
    try {
      const project = await projectApi.create(path)
      await get().loadProjects()
      set({ currentProject: project, isLoading: false })
      return project
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  openProject: async (path) => {
    set({ isLoading: true, error: null })
    try {
      const project = await projectApi.open(path)
      await get().loadProjects()
      set({ currentProject: project, isLoading: false })
      return project
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  deleteProject: async (projectId) => {
    set({ isLoading: true, error: null })
    try {
      await projectApi.delete(projectId)
      await get().loadProjects()
      if (get().currentProject?.id === projectId) {
        set({ currentProject: null })
      }
      set({ isLoading: false })
    } catch (error) {
      set({ error: String(error), isLoading: false })
      throw error
    }
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  clearError: () => set({ error: null }),
}))
