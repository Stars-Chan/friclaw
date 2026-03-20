// src/config.ts
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { deepMerge, removeUndefined } from './utils/deep-merge'

const AgentSchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  summaryModel: z.string().default('claude-haiku-4-5'),
  maxConcurrent: z.number().default(5),
  timeout: z.number().default(300_000),
  allowedTools: z.array(z.string()).optional(), // 工具白名单，为空则跳过权限检查
}).default({})

const MemorySchema = z.object({
  dir: z.string().default(join(homedir(), '.friclaw', 'memory')),
  searchLimit: z.number().default(10),
  vectorEnabled: z.boolean().default(false),
  vectorEndpoint: z.string().default('http://localhost:6333'),
}).default({})

const WorkspacesSchema = z.object({
  dir: z.string().default(join(homedir(), '.friclaw', 'workspaces')),
  maxSessions: z.number().default(10),
  sessionTimeout: z.number().default(3600),
}).default({})

const DashboardSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(3000),
}).default({})

const LoggingSchema = z.object({
  level: z.string().default('info'),
  dir: z.string().default(join(homedir(), '.friclaw', 'logs')),
}).default({})

const GatewaysSchema = z.object({
  feishu: z.object({
    enabled: z.boolean().default(false),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    encryptKey: z.string().optional(),
    verificationToken: z.string().optional(),
  }).default({}),
  wecom: z.object({
    enabled: z.boolean().default(false),
    botId: z.string().optional(),
    secret: z.string().optional(),
  }).default({}),
}).default({})

export const ConfigSchema = z.object({
  agent: AgentSchema,
  memory: MemorySchema,
  workspaces: WorkspacesSchema,
  dashboard: DashboardSchema,
  logging: LoggingSchema,
  gateways: GatewaysSchema,
})

export type FriClawConfig = z.infer<typeof ConfigSchema>

function buildEnvOverrides(): Record<string, unknown> {
  return removeUndefined({
    dashboard: {
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
    },
    logging: {
      level: process.env.LOG_LEVEL,
    },
    memory: {
      vectorEnabled: process.env.FRICLAW_VECTOR_ENABLED !== undefined
        ? process.env.FRICLAW_VECTOR_ENABLED === 'true'
        : undefined,
      vectorEndpoint: process.env.FRICLAW_VECTOR_ENDPOINT,
    },
    gateways: {
      feishu: {
        appId: process.env.FEISHU_APP_ID,
        appSecret: process.env.FEISHU_APP_SECRET,
        encryptKey: process.env.FEISHU_ENCRYPT_KEY,
        verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      },
      wecom: {
        botId: process.env.WECOM_BOT_ID,
        secret: process.env.WECOM_SECRET,
      },
    },
  })
}

export async function loadConfig(): Promise<FriClawConfig> {
  const configPath = process.env.FRICLAW_CONFIG
    ?? join(homedir(), '.friclaw', 'config.json')

  let fileConfig: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (e) {
      throw new Error(`Failed to parse config at ${configPath}: ${(e as Error).message}`)
    }
  }

  const merged = deepMerge(fileConfig, buildEnvOverrides())
  const result = ConfigSchema.safeParse(merged)
  if (!result.success) {
    const lines = result.error.errors
      .map(err => `  ${err.path.join('.')}: ${err.message}`)
      .join('\n')
    throw new Error(`配置错误：\n${lines}`)
  }
  return result.data
}
