/**
 * Simple in-memory store for tracking last visited terminal per project.
 * Used by router to restore terminal selection when navigating to a project.
 */
const lastTerminalByProject = new Map<string, string>()

export function getLastTerminal(projectId: string): string | null {
  return lastTerminalByProject.get(projectId) ?? null
}

export function setLastTerminal(projectId: string, terminalId: string): void {
  lastTerminalByProject.set(projectId, terminalId)
}
