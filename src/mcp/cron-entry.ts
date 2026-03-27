import { join } from 'path'
import { loadConfig } from '../config'
import { CronStorage } from '../cron/storage'
import { CronMcpServer } from '../cron/mcp-server'

async function main() {
  const config = await loadConfig()
  const dbPath = join(config.workspaces.dir, 'cron.db')

  // 只使用 storage，不启动 scheduler（主进程负责调度）
  const storage = new CronStorage(dbPath)

  const server = new CronMcpServer(storage)
  await server.start()
}

main().catch((e) => {
  process.stderr.write(`friclaw-cron MCP server error: ${e.message}\n`)
  process.exit(1)
})
