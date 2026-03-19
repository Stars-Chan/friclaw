# Config System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全配置系统，增加 gateways schema、环境变量覆盖、工具函数和友好错误输出。

**Architecture:** 新增 `src/utils/deep-merge.ts` 提供 `deepMerge` / `removeUndefined`；`loadConfig()` 在 Zod 校验前先将文件配置与环境变量覆盖深合并；校验失败时输出中文友好错误。

**Tech Stack:** Bun, TypeScript, Zod 3.x, bun:test

---

## 现状说明

`src/config.ts` 已实现基础骨架（schema + 文件读取 + Zod 校验），但缺少：

| 缺失项 | 说明 |
|--------|------|
| `gateways` schema | feishu / wecom 网关配置 |
| `agent.maxConcurrent` | 最大并发 Agent 数 |
| 环境变量覆盖 | PORT / LOG_LEVEL / FEISHU_* / WECOM_* / FRICLAW_VECTOR_* |
| `deepMerge` / `removeUndefined` | 合并工具函数 |
| 友好错误输出 | 中文字段路径提示 |
| `config.example.json` | 示例配置文件 |

---

## 设计偏差说明

本计划在以下两处有意偏离 `02-config-system.md` 规格：

| 规格定义 | 本计划实现 | 原因 |
|---------|-----------|------|
| 顶层 `port` / `logLevel` 字段 | `dashboard.port` / `logging.level` 嵌套字段 | 与 DESIGN.md 5.1 节保持一致，结构更清晰，已有代码也采用此结构 |
| 校验失败时 `process.exit(1)` | 抛出 `Error` | `process.exit` 在库函数中是反模式，抛出异常可测试性更好；规格文档应同步更新 |
| `FRICLAW_VECTOR_ENABLED` 未设置时求值为 `false`（覆盖文件配置） | 未设置时跳过覆盖，保留文件配置值 | 规格实现会导致环境变量缺失时静默覆盖文件中的 `true`，属于 bug；本计划用 `!== undefined` 判断修正 |

---

## File Structure

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `src/utils/deep-merge.ts` | deepMerge + removeUndefined |
| Create | `tests/unit/utils/deep-merge.test.ts` | 工具函数单元测试 |
| Modify | `src/config.ts` | 增加 gateways、maxConcurrent、env 覆盖、友好错误 |
| Modify | `tests/unit/config.test.ts` | 增加 gateways、env 覆盖、友好错误测试 |
| Create | `config.example.json` | 示例配置（提交到仓库） |

---

## Task 1: deepMerge + removeUndefined 工具函数

**Files:**
- Create: `src/utils/deep-merge.ts`
- Create: `tests/unit/utils/deep-merge.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/utils/deep-merge.test.ts
import { describe, it, expect } from 'bun:test'
import { deepMerge, removeUndefined } from '../../../src/utils/deep-merge'

describe('deepMerge', () => {
  it('override wins for scalar values', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  it('preserves base keys not in override', () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 })
  })

  it('recursively merges nested objects', () => {
    expect(deepMerge({ x: { a: 1, b: 2 } }, { x: { b: 9 } }))
      .toEqual({ x: { a: 1, b: 9 } })
  })

  it('override scalar replaces base object', () => {
    expect(deepMerge({ x: { a: 1 } }, { x: 'flat' as unknown }))
      .toEqual({ x: 'flat' })
  })
})

describe('removeUndefined', () => {
  it('removes undefined values', () => {
    expect(removeUndefined({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  it('recursively removes undefined in nested objects', () => {
    expect(removeUndefined({ x: { a: 1, b: undefined } }))
      .toEqual({ x: { a: 1 } })
  })

  it('preserves false and 0', () => {
    expect(removeUndefined({ a: false, b: 0, c: '' }))
      .toEqual({ a: false, b: 0, c: '' })
  })

  it('preserves null', () => {
    expect(removeUndefined({ a: null })).toEqual({ a: null })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/utils/deep-merge.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/utils/deep-merge'`

- [ ] **Step 3: 实现工具函数**

```typescript
// src/utils/deep-merge.ts
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    const b = result[key]
    const o = override[key]
    if (isPlainObject(o) && isPlainObject(b)) {
      result[key] = deepMerge(
        b as Record<string, unknown>,
        o as Record<string, unknown>,
      )
    } else {
      result[key] = o
    }
  }
  return result
}

export function removeUndefined(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (val === undefined) continue
    result[key] = isPlainObject(val)
      ? removeUndefined(val as Record<string, unknown>)
      : val
  }
  return result
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/utils/deep-merge.test.ts
bun run typecheck
```

Expected: 8 tests pass，typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add src/utils/deep-merge.ts tests/unit/utils/deep-merge.test.ts
git commit -m "feat: add deepMerge and removeUndefined utilities"
```

---

## Task 2: 增加 gateways schema 和 agent.maxConcurrent

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/unit/config.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/config.test.ts` 的 `describe('loadConfig')` 块末尾追加：

```typescript
  it('returns default agent maxConcurrent', async () => {
    const config = await loadConfig()
    expect(config.agent.maxConcurrent).toBe(5)
  })

  it('returns default gateways config', async () => {
    const config = await loadConfig()
    expect(config.gateways.feishu.enabled).toBe(false)
    expect(config.gateways.wecom.enabled).toBe(false)
  })

  it('merges partial gateway config from file', async () => {
    const tmpPath = '/tmp/friclaw-test-gateway.json'
    await Bun.write(tmpPath, JSON.stringify({
      gateways: { feishu: { enabled: true, appId: 'test-id' } }
    }))
    process.env.FRICLAW_CONFIG = tmpPath
    const config = await loadConfig()
    expect(config.gateways.feishu.enabled).toBe(true)
    expect(config.gateways.feishu.appId).toBe('test-id')
    expect(config.gateways.wecom.enabled).toBe(false) // default preserved
    try { unlinkSync(tmpPath) } catch {}
  })
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/config.test.ts
```

Expected: FAIL — `config.agent.maxConcurrent is undefined`, `config.gateways is undefined`

- [ ] **Step 3: 更新 src/config.ts schema**

在现有 `AgentSchema` 中加入 `maxConcurrent`，并新增 `GatewaysSchema`：

```typescript
// src/config.ts — 替换 AgentSchema
const AgentSchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  summaryModel: z.string().default('claude-haiku-4-5'),
  maxConcurrent: z.number().default(5),
  timeout: z.number().default(300_000),
}).default({})

// 在 LoggingSchema 之后新增
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

// 在 ConfigSchema 中加入 gateways
export const ConfigSchema = z.object({
  agent: AgentSchema,
  memory: MemorySchema,
  workspaces: WorkspacesSchema,
  dashboard: DashboardSchema,
  logging: LoggingSchema,
  gateways: GatewaysSchema,
})
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/config.test.ts
bun run typecheck
```

Expected: 所有已有测试 + 3 个新测试全部通过，typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: add gateways schema and agent.maxConcurrent to config"
```

---

## Task 3: 环境变量覆盖

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/unit/config.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/config.test.ts` 追加（注意 afterEach 需要清理新增的 env vars）：

```typescript
  describe('env var overrides', () => {
    afterEach(() => {
      delete process.env.PORT
      delete process.env.LOG_LEVEL
      delete process.env.FEISHU_APP_ID
      delete process.env.FEISHU_APP_SECRET
      delete process.env.WECOM_BOT_ID
      delete process.env.WECOM_SECRET
      delete process.env.FRICLAW_VECTOR_ENABLED
      delete process.env.FRICLAW_VECTOR_ENDPOINT
      delete process.env.FRICLAW_CONFIG  // 清理内部测试设置的临时路径，防止泄漏到同块后续测试
    })

    it('PORT overrides dashboard.port', async () => {
      process.env.PORT = '8080'
      const config = await loadConfig()
      expect(config.dashboard.port).toBe(8080)
    })

    it('LOG_LEVEL overrides logging.level', async () => {
      process.env.LOG_LEVEL = 'debug'
      const config = await loadConfig()
      expect(config.logging.level).toBe('debug')
    })

    it('FEISHU_APP_ID overrides gateways.feishu.appId', async () => {
      process.env.FEISHU_APP_ID = 'cli_abc123'
      const config = await loadConfig()
      expect(config.gateways.feishu.appId).toBe('cli_abc123')
    })

    it('FEISHU_APP_SECRET overrides gateways.feishu.appSecret', async () => {
      process.env.FEISHU_APP_SECRET = 'secret_xyz'
      const config = await loadConfig()
      expect(config.gateways.feishu.appSecret).toBe('secret_xyz')
    })

    it('WECOM_BOT_ID overrides gateways.wecom.botId', async () => {
      process.env.WECOM_BOT_ID = 'bot_001'
      const config = await loadConfig()
      expect(config.gateways.wecom.botId).toBe('bot_001')
    })

    it('FRICLAW_VECTOR_ENABLED=true sets memory.vectorEnabled', async () => {
      process.env.FRICLAW_VECTOR_ENABLED = 'true'
      const config = await loadConfig()
      expect(config.memory.vectorEnabled).toBe(true)
    })

    it('FRICLAW_VECTOR_ENABLED=false overrides file config true', async () => {
      const tmpPath = '/tmp/friclaw-test-vector.json'
      await Bun.write(tmpPath, JSON.stringify({ memory: { vectorEnabled: true } }))
      process.env.FRICLAW_CONFIG = tmpPath
      process.env.FRICLAW_VECTOR_ENABLED = 'false'
      const config = await loadConfig()
      expect(config.memory.vectorEnabled).toBe(false)
      try { unlinkSync(tmpPath) } catch {}
    })

    it('env vars override file config values', async () => {
      const tmpPath = '/tmp/friclaw-test-env-override.json'
      await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 4000 } }))
      process.env.FRICLAW_CONFIG = tmpPath
      process.env.PORT = '9000'
      const config = await loadConfig()
      expect(config.dashboard.port).toBe(9000)
      try { unlinkSync(tmpPath) } catch {}
    })
  })
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/config.test.ts
```

Expected: FAIL — env vars 未生效，port 仍为默认值

- [ ] **Step 3: 在 src/config.ts 实现环境变量覆盖**

在文件顶部 import 中加入 deep-merge，并替换 `loadConfig` 实现：

```typescript
// src/config.ts 顶部新增 import
import { deepMerge, removeUndefined } from './utils/deep-merge'

// 在 ConfigSchema 之后新增
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

// 替换 loadConfig 中的合并逻辑（保留文件读取部分不变）
// 将原来的:
//   const result = ConfigSchema.safeParse(raw)
// 替换为:
  const merged = deepMerge(
    fileConfig as Record<string, unknown>,
    buildEnvOverrides(),
  )
  const result = ConfigSchema.safeParse(merged)
```

完整的 `loadConfig` 函数：

```typescript
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
    throw new Error(`Invalid config at ${configPath}: ${result.error.message}`)
  }
  return result.data
}
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/config.test.ts
bun run typecheck
```

Expected: 所有测试通过（含 8 个新 env var 测试），typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: implement env var overrides for config (PORT, LOG_LEVEL, FEISHU_*, WECOM_*, FRICLAW_VECTOR_*)"
```

---

## Task 4: 友好错误输出

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/unit/config.test.ts`

- [ ] **Step 1: 写失败测试**

将 `tests/unit/config.test.ts` 中现有的 `'throws on invalid field type'` 测试更新，并新增路径提示测试：

```typescript
  // 更新现有测试（将 'Invalid config' 改为 '配置错误'）
  it('throws on invalid field type', async () => {
    const tmpPath = '/tmp/friclaw-test-invalid.json'
    await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 'not-a-number' } }))
    process.env.FRICLAW_CONFIG = tmpPath
    await expect(loadConfig()).rejects.toThrow('配置错误')
    try { unlinkSync(tmpPath) } catch {}
  })

  // 新增：错误信息包含字段路径
  it('error message includes field path', async () => {
    const tmpPath = '/tmp/friclaw-test-path.json'
    await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 'bad' } }))
    process.env.FRICLAW_CONFIG = tmpPath
    await expect(loadConfig()).rejects.toThrow('dashboard.port')
    try { unlinkSync(tmpPath) } catch {}
  })
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/config.test.ts
```

Expected: FAIL — `'throws on invalid field type'` 期望 `'配置错误'` 但收到 `'Invalid config'`

- [ ] **Step 3: 更新 loadConfig 错误处理**

将 `loadConfig` 中的错误处理替换为：

```typescript
  if (!result.success) {
    const lines = result.error.errors
      .map(err => `  ${err.path.join('.')}: ${err.message}`)
      .join('\n')
    throw new Error(`配置错误：\n${lines}`)
  }
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/config.test.ts
bun run typecheck
```

Expected: 所有测试通过，typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: friendly Chinese error output for config validation failures"
```

---

## Task 5: config.example.json

**Files:**
- Create: `config.example.json`

- [ ] **Step 1: 创建示例配置文件**

```json
{
  "agent": {
    "model": "claude-sonnet-4-6",
    "summaryModel": "claude-haiku-4-5",
    "maxConcurrent": 5,
    "timeout": 300000
  },
  "memory": {
    "dir": "~/.friclaw/memory",
    "searchLimit": 10,
    "vectorEnabled": false,
    "vectorEndpoint": "http://localhost:6333"
  },
  "workspaces": {
    "dir": "~/.friclaw/workspaces",
    "maxSessions": 10,
    "sessionTimeout": 3600
  },
  "dashboard": {
    "enabled": true,
    "port": 3000
  },
  "logging": {
    "level": "info",
    "dir": "~/.friclaw/logs"
  },
  "gateways": {
    "feishu": {
      "enabled": false
    },
    "wecom": {
      "enabled": false
    }
  }
}
```

> 凭证字段（appId、appSecret、encryptKey、verificationToken、botId、secret）通过环境变量配置，见 DESIGN.md 7.4 节。启用网关时设置对应环境变量即可，无需写入配置文件。

- [ ] **Step 2: 运行全量测试，确认无回归**

```bash
bun test
```

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add config.example.json
git commit -m "chore: add config.example.json"
```

---

## 验收检查

完成所有任务后，验证以下验收标准：

- [ ] `bun test` 全部通过
- [ ] `bun run typecheck` 无类型错误
- [ ] 缺少必填字段时，错误信息包含 `配置错误：` 和具体字段路径
- [ ] `PORT=8080 bun run src/index.ts` 启动时 dashboard 监听 8080
- [ ] `config.example.json` 存在且可直接复制为 `~/.friclaw/config.json` 使用
