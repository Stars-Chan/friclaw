// src/config.ts
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { deepMerge, removeUndefined } from './utils/deep-merge'

const AgentSchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  summaryModel: z.string().default('claude-haiku-4-5'),
  summaryTimeout: z.number().default(300), // 摘要生成超时（秒）
  maxConcurrent: z.number().default(5),
  timeout: z.number().default(300_000),
  allowedTools: z.array(z.string()).optional(), // 工具白名单，为空则跳过权限检查
}).default({})

const MemoryRetrievalSchema = z.object({
  knowledgeItems: z.number().int().positive().default(3),
  knowledgeChars: z.number().int().positive().default(320),
  recentEpisodes: z.number().int().positive().default(5),
  threadEpisodes: z.number().int().positive().default(3),
  episodeChars: z.number().int().positive().default(700),
  promptChars: z.number().int().positive().default(1800),
  diagnosticsEnabled: z.boolean().default(true),
}).default({})

const MemorySchema = z.object({
  dir: z.string().default(join(homedir(), '.friclaw', 'memory')),
  searchLimit: z.number().default(10),
  vectorEnabled: z.boolean().default(false),
  vectorEndpoint: z.string().default('http://localhost:6333'),
  retrieval: MemoryRetrievalSchema,
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

const ProactiveSchema = z.object({
  enabled: z.boolean().default(false),
  remindersEnabled: z.boolean().default(true),
  dailySummaryEnabled: z.boolean().default(true),
  patternSuggestionsEnabled: z.boolean().default(true),
  reminderIntervalMinutes: z.number().int().positive().default(180),
  dailySummaryHour: z.number().int().min(0).max(23).default(9),
  quietHours: z.object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(0).max(23),
  }).optional(),
}).default({})

const LoggingSchema = z.object({
  level: z.string().default('info'),
  dir: z.string().default(join(homedir(), '.friclaw', 'logs')),
}).default({})

const DaemonSchema = z.object({
  enabled: z.boolean().default(true),
  pidFile: z.string().default(join(homedir(), '.friclaw', 'friclaw.pid')),
  takeover: z.boolean().default(true),
  disableInContainer: z.boolean().default(true),
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
  weixin: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().default('https://ilinkai.weixin.qq.com'),
    cdnBaseUrl: z.string().default('https://cdn.weixin.qq.com'),
    token: z.string().optional(),
  }).default({}),
}).default({})

export const ConfigSchema = z.object({
  agent: AgentSchema,
  memory: MemorySchema,
  workspaces: WorkspacesSchema,
  dashboard: DashboardSchema,
  proactive: ProactiveSchema,
  logging: LoggingSchema,
  daemon: DaemonSchema,
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
    proactive: {
      enabled: process.env.FRICLAW_PROACTIVE_ENABLED !== undefined
        ? process.env.FRICLAW_PROACTIVE_ENABLED === 'true'
        : undefined,
      remindersEnabled: process.env.FRICLAW_PROACTIVE_REMINDERS_ENABLED !== undefined
        ? process.env.FRICLAW_PROACTIVE_REMINDERS_ENABLED === 'true'
        : undefined,
      dailySummaryEnabled: process.env.FRICLAW_PROACTIVE_DAILY_SUMMARY_ENABLED !== undefined
        ? process.env.FRICLAW_PROACTIVE_DAILY_SUMMARY_ENABLED === 'true'
        : undefined,
      patternSuggestionsEnabled: process.env.FRICLAW_PROACTIVE_PATTERN_SUGGESTIONS_ENABLED !== undefined
        ? process.env.FRICLAW_PROACTIVE_PATTERN_SUGGESTIONS_ENABLED === 'true'
        : undefined,
      reminderIntervalMinutes: process.env.FRICLAW_PROACTIVE_REMINDER_INTERVAL_MINUTES
        ? Number(process.env.FRICLAW_PROACTIVE_REMINDER_INTERVAL_MINUTES)
        : undefined,
      dailySummaryHour: process.env.FRICLAW_PROACTIVE_DAILY_SUMMARY_HOUR
        ? Number(process.env.FRICLAW_PROACTIVE_DAILY_SUMMARY_HOUR)
        : undefined,
    },
    daemon: {
      enabled: process.env.FRICLAW_DAEMON_ENABLED !== undefined
        ? process.env.FRICLAW_DAEMON_ENABLED === 'true'
        : process.env.FRICLAW_DISABLE_DAEMON !== undefined
          ? process.env.FRICLAW_DISABLE_DAEMON !== 'true'
          : undefined,
      pidFile: process.env.FRICLAW_PID_FILE,
      takeover: process.env.FRICLAW_DAEMON_TAKEOVER !== undefined
        ? process.env.FRICLAW_DAEMON_TAKEOVER === 'true'
        : undefined,
      disableInContainer: process.env.FRICLAW_DAEMON_DISABLE_IN_CONTAINER !== undefined
        ? process.env.FRICLAW_DAEMON_DISABLE_IN_CONTAINER === 'true'
        : undefined,
    },
    memory: {
      vectorEnabled: process.env.FRICLAW_VECTOR_ENABLED !== undefined
        ? process.env.FRICLAW_VECTOR_ENABLED === 'true'
        : undefined,
      vectorEndpoint: process.env.FRICLAW_VECTOR_ENDPOINT,
      retrieval: {
        diagnosticsEnabled: process.env.FRICLAW_MEMORY_DIAGNOSTICS_ENABLED !== undefined
          ? process.env.FRICLAW_MEMORY_DIAGNOSTICS_ENABLED === 'true'
          : undefined,
      },
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
      weixin: {
        baseUrl: process.env.WEIXIN_BASE_URL,
        cdnBaseUrl: process.env.WEIXIN_CDN_BASE_URL,
        token: process.env.WEIXIN_TOKEN,
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
