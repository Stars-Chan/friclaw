# 02 配置系统

## 目标

实现统一的配置加载、校验和热重载机制，支持文件配置 + 环境变量覆盖。

## 子任务

### 2.1 定义配置 Schema

用 Zod 定义完整的配置结构，确保启动时校验失败能给出明确错误：

```typescript
// src/config.ts
import { z } from 'zod'

const ConfigSchema = z.object({
  port: z.number().default(3000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  agent: z.object({
    model: z.string().default('claude-sonnet-4-6'),
    summaryModel: z.string().default('claude-haiku-4-5'),
    maxConcurrent: z.number().default(5),
    sessionTimeout: z.number().default(1800), // 秒
  }),

  memory: z.object({
    dbPath: z.string().default('~/.friclaw/memory.db'),
    vectorEnabled: z.boolean().default(false),
    vectorEndpoint: z.string().optional(),
  }),

  gateways: z.object({
    feishu: z.object({
      enabled: z.boolean().default(false),
      appId: z.string().optional(),
      appSecret: z.string().optional(),
      encryptKey: z.string().optional(),
      verificationToken: z.string().optional(),
    }),
    wecom: z.object({
      enabled: z.boolean().default(false),
      botId: z.string().optional(),
      secret: z.string().optional(),
    }),
  }),
})

export type Config = z.infer<typeof ConfigSchema>
```

### 2.2 实现配置加载

优先级：环境变量 > `~/.friclaw/config.json` > 默认值

```typescript
export async function loadConfig(): Promise<Config> {
  // 1. 读取配置文件
  let fileConfig = {}
  const configPath = path.resolve(
    process.env.FRICLAW_CONFIG ?? `${os.homedir()}/.friclaw/config.json`
  )
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  }

  // 2. 环境变量覆盖
  const envOverrides = {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    logLevel: process.env.LOG_LEVEL,
    memory: {
      vectorEnabled: process.env.FRICLAW_VECTOR_ENABLED === 'true',
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
  }

  // 3. 深合并 + Zod 校验
  const merged = deepMerge(fileConfig, removeUndefined(envOverrides))
  return ConfigSchema.parse(merged)
}
```

### 2.3 配置文件模板

`config.example.json`（提交到仓库，用户复制后填写）：

```json
{
  "port": 3000,
  "logLevel": "info",
  "agent": {
    "maxConcurrent": 5,
    "sessionTimeout": 1800
  },
  "memory": {
    "dbPath": "~/.friclaw/memory.db",
    "vectorEnabled": false
  },
  "gateways": {
    "feishu": {
      "enabled": false,
      "appId": "",
      "appSecret": "",
      "encryptKey": "",
      "verificationToken": ""
    },
    "wecom": {
      "enabled": false,
      "botId": "",
      "secret": ""
    }
  }
}
```

### 2.4 工具函数

- `deepMerge(a, b)` — 深合并两个对象，b 覆盖 a
- `removeUndefined(obj)` — 递归删除值为 undefined 的字段，避免覆盖默认值

### 2.5 配置校验错误处理

启动时若校验失败，打印友好错误并退出：

```typescript
try {
  return ConfigSchema.parse(merged)
} catch (e) {
  if (e instanceof z.ZodError) {
    console.error('配置错误：')
    e.errors.forEach(err => console.error(`  ${err.path.join('.')}: ${err.message}`))
    process.exit(1)
  }
  throw e
}
```

## 验收标准

- 缺少必填字段时，启动报错并指出具体字段
- 环境变量能正确覆盖文件配置
- `config.example.json` 存在且可直接复制使用
