// src/config.ts
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const AgentSchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  summaryModel: z.string().default('claude-haiku-4-5'),
  timeout: z.number().default(300_000),
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

export const ConfigSchema = z.object({
  agent: AgentSchema,
  memory: MemorySchema,
  workspaces: WorkspacesSchema,
  dashboard: DashboardSchema,
  logging: LoggingSchema,
})

export type FriClawConfig = z.infer<typeof ConfigSchema>

export async function loadConfig(): Promise<FriClawConfig> {
  const configPath = process.env.FRICLAW_CONFIG
    ?? join(homedir(), '.friclaw', 'config.json')

  let raw: unknown = {}
  if (existsSync(configPath)) {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'))
  }

  return ConfigSchema.parse(raw)
}
