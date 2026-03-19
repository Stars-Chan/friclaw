import { loadConfig } from '../config'
import { MemoryManager } from '../memory/manager'
import { MemoryMcpServer } from '../memory/mcp-server'

async function main() {
  const config = await loadConfig()
  const manager = new MemoryManager(config.memory)
  await manager.init()

  const server = new MemoryMcpServer(manager)
  await server.start()
}

main().catch((e) => {
  process.stderr.write(`friclaw-memory MCP server error: ${e.message}\n`)
  process.exit(1)
})
