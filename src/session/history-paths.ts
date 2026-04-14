import { join } from 'path'

export function getWorkspaceHistoryDir(workspaceDir: string): string {
  return join(workspaceDir, '.history')
}

export function getWorkspaceHistoryFile(workspaceDir: string, fileName: string): string {
  return join(getWorkspaceHistoryDir(workspaceDir), fileName)
}

export function getWorkspaceDailyHistoryFile(workspaceDir: string, date: string): string {
  return getWorkspaceHistoryFile(workspaceDir, `${date}.txt`)
}
