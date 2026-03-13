# 01. 配置系统模块

> FriClaw 配置系统详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

配置系统负责加载、验证、管理和提供系统配置，是所有模块的基础设施。

**核心功能**:
- 从 JSON 文件和环境变量加载配置
- 配置验证和类型检查
- 环境变量替换（`${VAR_NAME}` 语法）
- 配置热重载（可选）
- 配置 Schema 验证

### 1.2 与其他模块的关系

```
配置系统
    │
    ├──→ 所有模块（作为依赖）
    │     - 网关层
    │     - 会话层
    │     - Agent 层
    │     - 内存层
    │     - MCP 框架
    │     - 定时任务
    │     - Dashboard
```

---

## 2. 架构设计

### 2.1 核心组件

```typescript
// 配置管理器 - 单例模式
class ConfigManager {
  private static instance: ConfigManager;
  private config: FriClawConfig;
  private schema: JSONSchema7;
  private watchers: Map<string, Set<ConfigWatcher>>;

  // 单例获取
  static getInstance(): ConfigManager;

  // 配置加载
  async load(configPath?: string): Promise<FriClawConfig>;
  async reload(): Promise<void>;

  // 配置访问
  get<T = any>(path: string): T;
  getSection<T extends keyof FriClawConfig>(
    section: T
  ): FriClawConfig[T];

  // 配置观察
  watch(path: string, callback: ConfigWatcher): void;
  unwatch(path: string, callback: ConfigWatcher): void;
}

// 配置验证器
class ConfigValidator {
  private schema: JSONSchema7;

  validate(config: FriClawConfig): ValidationResult;
  validateSection(
    section: keyof FriClawConfig,
    data: any
  ): ValidationResult;
}

// 环境变量处理器
class EnvProcessor {
  process(config: any): any;
  expandEnvVars(value: any): any;
  getEnvVar(name: string): string | undefined;
}
```

### 2.2 配置加载流程

```
┌─────────────┐
│ 配置文件路径  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 读取 JSON   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 环境变量替换 │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Schema 验证 │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 默认值填充   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 配置对象     │
└─────────────┘
```

---

## 3. 详细设计

### 3.1 配置数据结构

```typescript
// 主配置接口
interface FriClawConfig {
  $schema?: string;          // Schema URL

  // AI 配置
  agent: AgentConfig;

  // 网关配置
  gateways: GatewayConfig;

  // 内存配置
  memory: MemoryConfig;

  // MCP 服务器配置
  mcpServers: MCPServersConfig;

  // 工作空间配置
  workspaces: WorkspaceConfig;

  // 定时任务配置
  cron: CronConfig;

  // 日志配置
  logging: LoggingConfig;

  // Dashboard 配置
  dashboard: DashboardConfig;
}

// AI Agent 配置
interface AgentConfig {
  type: 'claude_code' | 'custom';
  model: string;
  summaryModel?: string;
  allowedTools: string[];
  timeoutSecs: number;
  maxRetries?: number;
}

// 网关配置
interface GatewayConfig {
  feishu?: FeishuConfig;
  wecom?: WeComConfig;
  slack?: SlackConfig;
}

// 飞书配置
interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  events: string[];
  endpointUrl?: string;
}

// 企业微信配置
interface WeComConfig {
  botId: string;
  secret: string;
  endpointUrl?: string;
}

// Slack 配置
interface SlackConfig {
  botToken: string;
  appToken?: string;
  signingSecret: string;
  endpointUrl?: string;
}

// 内存配置
interface MemoryConfig {
  dir: string;
  searchLimit: number;
  cacheSize?: number;
  autoPrune?: boolean;
}

// MCP 服务器配置
interface MCPServersConfig {
  [serverName: string]: MCPServerConfig;
}

interface MCPServerConfig {
  type: 'stdio' | 'sse' | 'http';
  command?: string;          // stdio 模式
  args?: string[];           // stdio 模式
  url?: string;              // http/sse 模式
  env?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
}

// 工作空间配置
interface WorkspaceConfig {
  dir: string;
  maxSessions: number;
  sessionTimeout: number;
  autoCleanup: boolean;
  maxAge?: number;          // 最大保留时间（秒）
}

// 定时任务配置
interface CronConfig {
  enabled: boolean;
  scheduler: 'node-cron' | 'custom';
  maxConcurrentJobs: number;
  timezone: string;
}

// 日志配置
interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  dir: string;
  maxSize: string;
  maxFiles: number;
  format?: 'json' | 'text';
  console?: boolean;
}

// Dashboard 配置
interface DashboardConfig {
  enabled: boolean;
  port: number;
  host?: string;
  cors: boolean;
  auth?: AuthConfig;
}

// 认证配置
interface AuthConfig {
  enabled: boolean;
  username?: string;
  password?: string;
  token?: string;
}
```

### 3.2 环境变量处理

#### 变量替换规则

```typescript
// 支持的语法模式
${VAR_NAME}           // 简单替换
${VAR_NAME:default}   // 带默认值的替换
${VAR_NAME:-default}   // Bash 风格的默认值
```

#### 实现示例

```typescript
class EnvProcessor {
  // 主处理方法
  process(config: any): any {
    if (typeof config === 'string') {
      return this.expandEnvVars(config);
    }
    if (Array.isArray(config)) {
      return config.map(item => this.process(item));
    }
    if (typeof config === 'object' && config !== null) {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(config)) {
        result[key] = this.process(value);
      }
      return result;
    }
    return config;
  }

  // 展开环境变量
  private expandEnvVars(value: string): string {
    // 匹配 ${VAR_NAME:default} 或 ${VAR_NAME}
    return value.replace(/\$\{([^:}]+)(?::([^}]*))?\}/g, (match, expr, defaultValue) => {
      const envValue = process.env[expr];
      return envValue !== undefined ? envValue : (defaultValue || '');
    });
  }

  // 获取环境变量
  getEnvVar(name: string): string | undefined {
    return process.env[name];
  }
}
```

### 3.3 配置验证

#### Schema 验证

```typescript
// 验证结果
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  path: string;
  message: string;
  value?: any;
}

interface ValidationWarning {
  path: string;
  message: string;
  value?: any;
}

// 配置验证器
class ConfigValidator {
  private schema: JSONSchema7;

  constructor(schema: JSONSchema7) {
    this.schema = schema;
  }

  // 验证完整配置
  validate(config: FriClawConfig): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Schema 验证
    const schemaResult = this.validateBySchema(config);
    errors.push(...schemaResult.errors);

    // 2. 业务逻辑验证
    const businessResult = this.validateBusinessLogic(config);
    errors.push(...businessResult.errors);
    warnings.push(...businessResult.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // Schema 验证
  private validateBySchema(config: FriClawConfig): ValidationResult {
    // 使用 zod 或 ajv 进行 JSON Schema 验证
    // ...
  }

  // 业务逻辑验证
  private validateBusinessLogic(
    config: FriClawConfig
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 验证超时设置
    if (config.agent.timeoutSecs < 10) {
      errors.push({
        path: 'agent.timeoutSecs',
        message: 'Timeout must be at least 10 seconds',
        value: config.agent.timeoutSecs,
      });
    }

    // 验证目录是否存在
    this.validateDirectory('memory.dir', config.memory.dir, errors);
    this.validateDirectory('workspaces.dir', config.workspaces.dir, errors);

    // 验证端口范围
    if (config.dashboard.port < 1024 || config.dashboard.port > 65535) {
      errors.push({
        path: 'dashboard.port',
        message: 'Port must be between 1024 and 65535',
        value: config.dashboard.port,
      });
    }

    // 警告：密钥未设置
    if (!process.env['ANTHROPIC_AUTH_TOKEN'] && !config.agent.type) {
      warnings.push({
        path: 'agent',
        message: 'No API token configured',
      });
    }

    return { valid: false, errors, warnings };
  }

  // 验证目录
  private validateDirectory(
    path: string,
    dir: string,
    errors: ValidationError[]
  ): void {
    const expandedPath = this.expandPath(dir);
    if (!fs.existsSync(expandedPath)) {
      errors.push({
        path,
        message: `Directory does not exist: ${expandedPath}`,
        value: dir,
      });
    }
  }

  // 展开路径（处理 ~ 符号）
  private expandPath(path: string): string {
    return path.replace(/^~/, os.homedir());
  }
}
```

---

## 4. 接口规范

### 4.1 公共 API

```typescript
interface IConfigManager {
  /**
   * 加载配置
   * @param configPath 配置文件路径，默认为 ~/.friclaw/config.json
   * @returns 加载的配置对象
   * @throws ConfigError 配置加载失败时抛出
   */
  load(configPath?: string): Promise<FriClawConfig>;

  /**
   * 重新加载配置
   */
  reload(): Promise<void>;

  /**
   * 获取配置值（支持点分隔的路径）
   * @param path 配置路径，如 'agent.model'
   * @returns 配置值
   */
  get<T = any>(path: string): T;

  /**
   * 获取配置节
   * @param section 配置节名称
   * @returns 配置节对象
   */
  getSection<T extends keyof FriClawConfig>(
    section: T
  ): FriClawConfig[T];

  /**
   * 监听配置变化
   * @param path 配置路径
   * @param callback 回调函数
   */
  watch(path: string, callback: ConfigWatcher): void;

  /**
   * 取消监听
   */
  unwatch(path: string, callback: ConfigWatcher): void;
}

// 配置变化监听器
type ConfigWatcher = (newValue: any, oldValue: any) => void;
```

### 4.2 错误码定义

```typescript
// 配置错误码
enum ConfigErrorCode {
  FILE_NOT_FOUND = 'CONFIG_FILE_NOT_FOUND',
  INVALID_JSON = 'CONFIG_INVALID_JSON',
  VALIDATION_ERROR = 'CONFIG_VALIDATION_ERROR',
  MISSING_REQUIRED = 'CONFIG_MISSING_REQUIRED',
  INVALID_VALUE = 'CONFIG_INVALID_VALUE',
}

// 配置错误类
class ConfigError extends Error {
  code: ConfigErrorCode;
  path?: string;
  details?: any;

  constructor(
    code: ConfigErrorCode,
    message: string,
    path?: string,
    details?: any
  ) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.path = path;
    this.details = details;
  }
}
```

---

## 5. 实现细节

### 5.1 配置文件定位

```typescript
class ConfigLocator {
  // 配置文件搜索顺序
  private static searchPaths = [
    './config.json',
    './friclaw.json',
    '~/.friclaw/config.json',
    '~/.config/friclaw/config.json',
    '/etc/friclaw/config.json',
  ];

  /**
   * 查找配置文件
   * @returns 找到的配置文件路径，或 null
   */
  static findConfig(): string | null {
    for (const path of this.searchPaths) {
      const fullPath = this.expandPath(path);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }

  /**
   * 展开路径
   */
  private static expandPath(path: string): string {
    return path.replace(/^~/, os.homedir());
  }
}
```

### 5.2 默认配置

```typescript
// 默认配置
const DEFAULT_CONFIG: Partial<FriClawConfig> = {
  agent: {
    type: 'claude_code',
    model: 'glm-4.7',
    summaryModel: 'glm-4.7',
    allowedTools: [],
    timeoutSecs: 600,
    maxRetries: 3,
  },
  memory: {
    dir: '~/.friclaw/memory',
    searchLimit: 5,
    cacheSize: 1000,
    autoPrune: true,
  },
  workspaces: {
    dir: '~/.friclaw/workspaces',
    maxSessions: 1000,
    sessionTimeout: 3600,
    autoCleanup: true,
    maxAge: 7 * 24 * 3600,  // 7天
  },
  cron: {
    enabled: true,
    scheduler: 'node-cron',
    maxConcurrentJobs: 10,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  logging: {
    level: 'info',
    dir: '~/.friclaw/logs',
    maxSize: '100m',
    maxFiles: 7,
    format: 'json',
    console: true,
  },
  dashboard: {
    enabled: false,
    port: 3000,
    host: '0.0.0.0',
    cors: true,
  },
};

/**
 * 合并配置（默认配置 + 用户配置）
 */
function mergeConfig(
  userConfig: Partial<FriClawConfig>
): FriClawConfig {
  return deepMerge(DEFAULT_CONFIG, userConfig) as FriClawConfig;
}
```

### 5.3 配置热重载

```typescript
// 配置热重载观察者
class ConfigWatcher {
  private fsWatcher: fs.FSWatcher | null = null;
  private manager: ConfigManager;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(manager: ConfigManager) {
    this.manager = manager;
  }

  /**
   * 启动文件监听
   */
  start(configPath: string): void {
    if (this.fsWatcher) {
      this.stop();
    }

    this.fsWatcher = fs.watch(configPath, (eventType) => {
      if (eventType === 'change') {
        this.debounceReload();
      }
    });
  }

  /**
   * 停止文件监听
   */
  stop(): void {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * 防抖重载
   */
  private debounceReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        await this.manager.reload();
        this.manager.getLogger()?.info('Configuration reloaded');
      } catch (error) {
        this.manager.getLogger()?.error(
          'Failed to reload configuration',
          error
        );
      }
    }, 1000);  // 1秒防抖
  }
}
```

---

## 6. 测试策略

### 6.1 单元测试范围

```typescript
describe('ConfigManager', () => {
  describe('load()', () => {
    it('should load valid config file');
    it('should expand ~ in paths');
    it('should replace environment variables');
    it('should use default values');
    it('should throw error for invalid JSON');
    it('should throw error for missing required fields');
  });

  describe('get()', () => {
    it('should get value by path');
    it('should return undefined for non-existent path');
    it('should support nested paths');
  });

  describe('watch()', () => {
    it('should notify watchers on change');
    it('should support multiple watchers');
    it('should unwatch correctly');
  });
});

describe('EnvProcessor', () => {
  describe('expandEnvVars()', () => {
    it('should replace simple ${VAR}');
    it('should replace ${VAR:default}');
    it('should keep unmatched variable');
    it('should handle nested objects');
    it('should handle arrays');
  });
});

describe('ConfigValidator', () => {
  describe('validate()', () => {
    it('should pass valid config');
    it('should detect missing required fields');
    it('should detect invalid values');
    it('should generate warnings for non-optimal values');
  });
});
```

### 6.2 集成测试场景

1. 配置文件不存在时使用默认配置
2. 环境变量正确替换
3. 热重载功能正常工作
4. 配置错误时给出明确提示

### 6.3 性能测试指标

- 配置加载时间: < 100ms
- 配置访问时间: < 1ms (缓存)
- 环境变量替换: < 10ms

---

## 7. 依赖关系

### 7.1 外部依赖

```json
{
  "dependencies": {
    "zod": "^3.22.0",           // Schema 验证
    "dotenv": "^16.3.0"         // 环境变量加载（可选）
  }
}
```

### 7.2 内部模块依赖

```
配置系统
    ↓
    └──> 日志系统 (初始化时需要)
```

### 7.3 启动顺序

```
1. 配置系统 ← 最先启动
2. 日志系统
3. 其他模块...
```

---

## 8. 配置项

### 8.1 可配置参数

| 路径 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agent.type` | string | `claude_code` | Agent 类型 |
| `agent.model` | string | `glm-4.7` | 主模型 |
| `agent.timeoutSecs` | number | `600` | 超时时间（秒） |
| `memory.dir` | string | `~/.friclaw/memory` | 内存目录 |
| `memory.searchLimit` | number | `5` | 搜索结果限制 |
| `workspaces.dir` | string | `~/.friclaw/workspaces` | 工作空间目录 |
| `workspaces.maxSessions` | number | `1000` | 最大会话数 |
| `logging.level` | string | `info` | 日志级别 |
| `logging.dir` | string | `~/.friclaw/logs` | 日志目录 |
| `dashboard.enabled` | boolean | `false` | Dashboard 开关 |
| `dashboard.port` | number | `3000` | Dashboard 端口 |

### 8.2 环境变量映射

| 环境变量 | 配置路径 | 说明 |
|----------|----------|------|
| `FRICLAW_CONFIG` | - | 配置文件路径 |
| `FRICLAW_MODEL` | `agent.model` | AI 模型 |
| `FRICLAW_API_KEY` | - | API 密钥 |
| `FRICLAW_LOG_LEVEL` | `logging.level` | 日志级别 |
| `FRICLAW_PORT` | `dashboard.port` | 服务端口 |
| `FEISHU_APP_ID` | `gateways.feishu.appId` | 飞书 App ID |
| `FEISHU_APP_SECRET` | `gateways.feishu.appSecret` | 飞书 App Secret |
| `WECOM_BOT_ID` | `gateways.wecom.botId` | 企业微信 Bot ID |
| `WECOM_SECRET` | `gateways.wecom.secret` | 企业微信 Secret |

---

## 9. 监控和日志

### 9.1 关键指标

- 配置加载次数
- 配置重载次数
- 配置验证错误数
- 配置访问频率

### 9.2 日志级别

| 级别 | 用途 |
|------|------|
| `debug` | 配置加载详细过程 |
| `info` | 配置加载成功、重载成功 |
| `warn` | 配置警告、使用默认值 |
| `error` | 配置加载失败、验证失败 |

### 9.3 日志示例

```json
// 成功加载
{
  "level": "info",
  "message": "Configuration loaded successfully",
  "configPath": "/home/user/.friclaw/config.json",
  "config": {
    "agent": { "model": "glm-4.7", ... }
  }
}

// 验证警告
{
  "level": "warn",
  "message": "Configuration validation warnings",
  "warnings": [
    {
      "path": "agent.timeoutSecs",
      "message": "Timeout is very large, consider reducing"
    }
  ]
}

// 加载失败
{
  "level": "error",
  "message": "Failed to load configuration",
  "error": "Config file not found: ~/.friclaw/config.json",
  "code": "CONFIG_FILE_NOT_FOUND"
}
```

---

## 10. 安全考虑

### 10.1 敏感信息处理

```typescript
// 敏感字段列表
const SENSITIVE_FIELDS = [
  'appSecret',
  'secret',
  'token',
  'password',
  'apiKey',
  'authToken',
];

/**
 * 屏蔽敏感信息用于日志输出
 */
function sanitizeConfig(config: any): any {
  const sanitized = { ...config };

  for (const key of SENSITIVE_FIELDS) {
    if (sanitized[key]) {
      sanitized[key] = '***REDACTED***';
    }
  }

  // 递归处理嵌套对象
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeConfig(value);
    }
  }

  return sanitized;
}
```

### 10.2 输入验证

- 所有用户提供的配置必须经过验证
- 文件路径必须防止目录遍历攻击
- 端口号必须在合法范围内

### 10.3 文件权限

```typescript
/**
 * 检查配置文件权限
 */
function checkConfigPermissions(path: string): void {
  const stats = fs.statSync(path);

  // 检查是否是符号链接
  if (stats.isSymbolicLink()) {
    throw new ConfigError(
      ConfigErrorCode.INVALID_VALUE,
      'Config file must not be a symbolic link'
    );
  }

  // 检查是否可读
  if (!(fs.constants.R_OK & stats.mode)) {
    throw new ConfigError(
      ConfigErrorCode.FILE_NOT_FOUND,
      'Config file is not readable'
    );
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
