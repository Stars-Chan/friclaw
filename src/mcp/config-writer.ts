import { writeFileSync } from 'fs'
import { join } from 'path'

export interface StdioMcpServerConfig {
  type: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface HttpMcpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig

export function writeMcpConfig(
  workspaceDir: string,
  servers: Record<string, McpServerConfig>
): void {
  const mcpServers: Record<string, unknown> = {}

  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.type === 'stdio') {
      mcpServers[name] = {
        command: cfg.command,
        args: cfg.args,
        ...(cfg.env ? { env: cfg.env } : {}),
      }
    } else {
      mcpServers[name] = {
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
      }
    }
  }

  writeFileSync(
    join(workspaceDir, '.mcp.json'),
    JSON.stringify({ mcpServers }, null, 2),
    'utf-8'
  )
}
