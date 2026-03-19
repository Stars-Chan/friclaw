import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'

export { CallToolRequestSchema, ListToolsRequestSchema, type Tool, type CallToolResult }

export abstract class BaseMcpServer {
  protected server: Server

  constructor(name: string, version: string) {
    this.server = new Server(
      { name, version },
      { capabilities: { tools: {} } }
    )
    this.registerTools()
  }

  protected abstract getTools(): Tool[]
  protected abstract handleToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult>

  protected registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>
      return this.handleToolCall(req.params.name, args)
    })
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }

  protected ok(text: string): CallToolResult {
    return { content: [{ type: 'text', text }] }
  }

  protected err(message: string): CallToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
}
