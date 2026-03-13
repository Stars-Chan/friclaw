# 02. 日志系统模块

> FriClaw 日志系统详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

日志系统负责统一管理系统中所有模块的日志输出，提供结构化、可配置的日志记录功能。

**核心功能**:
- 多级别日志输出（debug、info、warn、error）
- 日志格式化（JSON、Text）
- 日志轮转（按大小、时间）
- 日志持久化（文件）
- 日志过滤（模块级别）
- 结构化日志（支持上下文）
- 日志异步输出

### 1.2 与其他模块的关系

```
日志系统
    ↑
    ├──> 配置系统（获取配置）
    ↑
    ├──> 所有模块（输出日志）
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
// 日志管理器 - 单例模式
class LoggerManager {
  private static instance: LoggerManager;
  private transports: Transport[];
  private defaultLogger: Logger;
  private config: LoggingConfig;

  // 获取单例
  static getInstance(): LoggerManager;

  // 初始化
  initialize(config: LoggingConfig): void;

  // 创建命名日志器
  getLogger(name: string): Logger;

  // 添加传输
  addTransport(transport: Transport): void;

  // 移除传输
  removeTransport(transport: Transport): void;

  // 关闭所有传输
  close(): Promise<void>;
}

// 日志器
class Logger {
  private name: string;
  private manager: LoggerManager;

  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: Error | any, meta?: any): void;

  // 创建子日志器
  child(name: string): Logger;

  // 设置级别
  setLevel(level: LogLevel): void;

  // 添加上下文
  withContext(context: Record<string, any>): Logger;
}

// 传输接口
interface Transport {
  name: string;
  level: LogLevel;
  format: LogFormat;

  log(entry: LogEntry): void | Promise<void>;
  close(): void | Promise<void>;
}

// 文件传输
class FileTransport implements Transport {
  private stream: fs.WriteStream;
  private path: string;
  private maxSize: number;
  private maxFiles: number;

  constructor(config: FileTransportConfig);
  log(entry: LogEntry): Promise<void>;
  close(): Promise<void>;

  private rotate(): void;
  private pruneOldFiles(): void;
}

// 控制台传输
class ConsoleTransport implements Transport {
  private format: LogFormat;

  constructor(config: ConsoleTransportConfig);
  log(entry: LogEntry): void;
  close(): void;
}
```

### 2.2 日志流程

```
┌─────────────┐
│  模块调用    │
│  logger.info │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Logger 实例  │
│ - 格式化    │
│ - 添加上下文 │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ LoggerManager│
│ - 级别过滤   │
└──────┬──────┘
       │
       ├──→ ┌─────────────┐
       │    │ FileTransport│
       │    │ - 写入文件   │
       │    └─────────────┘
       │
       ├──→ ┌─────────────┐
       │    │ ConsoleTrans │
       │    │ - 输出控制台 │
       │    └─────────────┘
       │
       └──→ ┌─────────────┐  (可选)
            │ RemoteTrans  │
            │ - 发送远程   │
            └─────────────┘
```

---

## 3. 详细设计

### 3.1 数据结构

```typescript
// 日志级别
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// 日志格式
enum LogFormat {
  JSON = 'json',
  TEXT = 'text',
}

// 日志条目
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  logger: string;
  message: string;
  error?: ErrorInfo;
  context?: Record<string, any>;
  stack?: string;
}

// 错误信息
interface ErrorInfo {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

// 日志配置
interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  dir: string;
  maxSize: string;
  maxFiles: number;
  console: boolean;
  transports?: TransportConfig[];
}

// 传输配置
interface TransportConfig {
  type: 'file' | 'console' | 'remote';
  level?: LogLevel;
  format?: LogFormat;
  [key: string]: any;
}

// 文件传输配置
interface FileTransportConfig extends TransportConfig {
  type: 'file';
  path: string;
  maxSize?: string;
  maxFiles?: number;
}

// 控制台传输配置
interface ConsoleTransportConfig extends TransportConfig {
  type: 'console';
  colorize?: boolean;
  timestamp?: boolean;
}

// 远程传输配置
interface RemoteTransportConfig extends TransportConfig {
  type: 'remote';
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
}
```

### 3.2 日志格式化

#### JSON 格式化器

```typescript
class JSONFormatter {
  format(entry: LogEntry): string {
    const formatted: Record<string, any> = {
      '@timestamp': entry.timestamp,
      '@level': LogLevel[entry.level],
      '@logger': entry.logger,
      message: entry.message,
    };

    if (entry.error) {
      formatted.error = {
        name: entry.error.name,
        message: entry.error.message,
        code: entry.error.code,
      };
    }

    if (entry.context) {
      Object.assign(formatted, entry.context);
    }

    if (entry.stack) {
      formatted.stack = entry.stack;
    }

    return JSON.stringify(formatted);
  }
}
```

#### Text 格式化器

```typescript
class TextFormatter {
  private colorize: boolean;
  private showTimestamp: boolean;

  constructor(options: { colorize?: boolean; timestamp?: boolean }) {
    this.colorize = options.colorize ?? true;
    this.showTimestamp = options.timestamp ?? true;
  }

  format(entry: LogEntry): string {
    const parts: string[] = [];

    // 时间戳
    if (this.showTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }

    // 级别（带颜色）
    const levelStr = LogLevel[entry.level].toLowerCase();
    const coloredLevel = this.colorize
      ? this.colorizeLevel(entry.level, levelStr)
      : levelStr;
    parts.push(`[${coloredLevel}]`);

    // 日志器名称
    parts.push(`[${entry.logger}]`);

    // 消息
    parts.push(entry.message);

    // 错误信息
    if (entry.error) {
      parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
      if (entry.error.code) {
        parts.push(`  Code: ${entry.error.code}`);
      }
      if (entry.error.stack) {
        parts.push(`\n${this.indent(entry.error.stack, 4)}`);
      }
    }

    // 上下文
    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(`\n${this.indent(JSON.stringify(entry.context, null, 2), 2)}`);
    }

    // 堆栈
    if (entry.stack) {
      parts.push(`\n${this.indent(entry.stack, 2)}`);
    }

    return parts.join(' ');
  }

  private colorizeLevel(level: LogLevel, text: string): string {
    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m',  // Cyan
      [LogLevel.INFO]: '\x1b[32m',   // Green
      [LogLevel.WARN]: '\x1b[33m',   // Yellow
      [LogLevel.ERROR]: '\x1b[31m',  // Red
    };
    const reset = '\x1b[0m';
    return `${colors[level]}${text}${reset}`;
  }

  private indent(text: string, spaces: number): string {
    const indentStr = ' '.repeat(spaces);
    return text.split('\n').map(line => indentStr + line).join('\n');
  }
}
```

### 3.3 日志轮转

```typescript
class FileTransport implements Transport {
  private stream: fs.WriteStream;
  private currentSize: number = 0;
  private maxSize: number;

  async log(entry: LogEntry): Promise<void> {
    const formatted = this.format(entry);
    const size = Buffer.byteLength(formatted, 'utf8') + 1; // +1 for newline

    // 检查是否需要轮转
    if (this.currentSize + size > this.maxSize) {
      await this.rotate();
    }

    return new Promise((resolve, reject) => {
      this.stream.write(formatted + '\n', (error) => {
        if (error) {
          reject(error);
        } else {
          this.currentSize += size;
          resolve();
        }
      });
    });
  }

  /**
   * 日志轮转
   */
  private async rotate(): Promise<void> {
    this.stream.end();

    // 移动当前文件
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${this.path}.${timestamp}`;

    await fs.promises.rename(this.path, rotatedPath);

    // 清理旧文件
    await this.pruneOldFiles();

    // 创建新文件
    this.stream = fs.createWriteStream(this.path, { flags: 'a' });
    this.currentSize = 0;
  }

  /**
   * 清理旧日志文件
   */
  private async pruneOldFiles(): Promise<void> {
    const files = await fs.promises.readdir(path.dirname(this.path));
    const logFiles = files
      .filter(f => f.startsWith(path.basename(this.path) + '.'))
      .sort();

    // 删除超出数量的文件
    while (logFiles.length > this.maxFiles) {
      const file = logFiles.shift();
      const fullPath = path.join(path.dirname(this.path), file!);
      await fs.promises.unlink(fullPath).catch(() => {});
    }
  }
}
```

### 3.4 上下文管理

```typescript
class Logger {
  private context: Record<string, any> = {};
  private static contextFields = new Set<string>([
    'sessionId',
    'userId',
    'chatId',
    'platform',
    'traceId',
  ]);

  /**
   * 添加上下文
   */
  withContext(context: Record<string, any>): Logger {
    const child = new Logger(this.name, this.manager);
    child.context = { ...this.context, ...context };
    return child;
  }

  /**
   * 创建日志条目
   */
  private createEntry(
    level: LogLevel,
    message: string,
    error?: Error | any,
    meta?: any
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
    };

    // 添加错误信息
    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        code: (error as any).code,
        stack: error.stack,
      };
    } else if (error) {
      entry.context = { ...entry.context, error };
    }

    // 添加元数据
    if (meta) {
      entry.context = { ...entry.context, ...meta };
    }

    // 添加持久上下文
    if (Object.keys(this.context).length > 0) {
      entry.context = { ...this.context, ...entry.context };
    }

    return entry;
  }

  /**
   * 输出日志
   */
  private log(
    level: LogLevel,
    message: string,
    error?: Error | any,
    meta?: any
  ): void {
    if (level < this.manager.getConfig().level) {
      return;
    }

    const entry = this.createEntry(level, message, error, meta);

    // 过滤不需要的上下文字段
    if (entry.context) {
      const filtered: Record<string, any> = {};
      for (const [key, value] of Object.entries(entry.context)) {
        if (Logger.contextFields.has(key)) {
          filtered[key] = value;
        }
      }
      entry.context = filtered;
    }

    // 发送到所有传输
    this.manager.getTransports().forEach(transport => {
      if (level >= transport.level) {
        transport.log(entry);
      }
    });
  }
}
```

---

## 4. 接口规范

### 4.1 公共 API

```typescript
interface ILogger {
  /**
   * Debug 级别日志
   */
  debug(message: string, meta?: any): void;

  /**
   * Info 级别日志
   */
  info(message: string, meta?: any): void;

  /**
   * Warn 级别日志
   */
  warn(message: string, meta?: any): void;

  /**
   * Error 级别日志
   */
  error(message: string, error?: Error | any, meta?: any): void;

  /**
   * 创建带上下文的子日志器
   */
  withContext(context: Record<string, any>): Logger;

  /**
   * 创建子日志器
   */
  child(name: string): Logger;

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void;
}
```

### 4.2 使用示例

```typescript
// 获取日志器
const logger = LoggerManager.getInstance().getLogger('gateway:feishu');

// 基础日志
logger.info('Gateway connected', { platform: 'feishu' });
logger.warn('Retry attempt 3', { attempts: 3 });
logger.error('Connection failed', error, { endpoint: url });

// 带上下文
const sessionLogger = logger.withContext({
  sessionId: 'abc123',
  userId: 'user456',
});
sessionLogger.info('Message received', { msgType: 'text' });

// 子日志器
const gatewayLogger = logger.child('feishu');
gatewayLogger.info('WebSocket connected');
```

---

## 5. 实现细节

### 5.1 级别过滤

```typescript
class LoggerManager {
  private config: LoggingConfig;

  /**
   * 检查是否应该记录日志
   */
  shouldLog(level: LogLevel, transportLevel: LogLevel): boolean {
    return level >= transportLevel;
  }

  /**
   * 设置全局日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}
```

### 5.2 异步日志输出

```typescript
class AsyncTransport implements Transport {
  private queue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private batchSize: number = 100;
  private flushInterval: number = 1000; // ms

  async log(entry: LogEntry): Promise<void> {
    this.queue.push(entry);

    // 检查是否需要刷新
    if (this.queue.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * 刷新队列
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const entries = [...this.queue];
    this.queue = [];

    // 批量写入
    await this.writeBatch(entries);
  }

  /**
   * 批量写入
   */
  private async writeBatch(entries: LogEntry[]): Promise<void> {
    // 子类实现
    throw new Error('Not implemented');
  }

  /**
   * 启动定时刷新
   */
  startPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        console.error('Failed to flush log batch', error);
      });
    }, this.flushInterval);
  }

  /**
   * 停止定时刷新
   */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
```

### 5.3 结构化错误

```typescript
/**
 * 提取结构化错误信息
 */
function extractErrorInfo(error: Error | any): ErrorInfo | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: (error as any).code,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      code: error.code,
      stack: error.stack,
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}
```

---

## 6. 测试策略

### 6.1 单元测试范围

```typescript
describe('Logger', () => {
  describe('level methods', () => {
    it('should output debug logs');
    it('should output info logs');
    it('should output warn logs');
    it('should output error logs');
    it('should respect level filter');
  });

  describe('context', () => {
    it('should include context in logs');
    it('should merge context with child logger');
    it('should handle nested context');
  });

  describe('error handling', () => {
    it('should log Error objects');
    it('should extract error stack');
    it('should handle non-error objects');
  });
});

describe('FileTransport', () => {
  describe('rotation', () => {
    it('should rotate when size exceeded');
    it('should append timestamp to rotated file');
    it('should prune old files');
  });

  describe('write', () => {
    it('should append to file');
    it('should create file if not exists');
    it('should handle write errors');
  });
});

describe('JSONFormatter', () => {
  it('should format entry as JSON');
  it('should include all fields');
  it('should handle missing fields');
});

describe('TextFormatter', () => {
  it('should format entry as text');
  it('should colorize output');
  it('should indent stack traces');
});
```

### 6.2 集成测试场景

1. 多传输同时工作
2. 日志轮转正确执行
3. 上下文正确传递
4. 错误正确序列化

### 6.3 性能测试指标

- 日志输出时间: < 1ms (同步), < 0.1ms (异步)
- 日志格式化时间: < 0.1ms
- 轮转操作时间: < 100ms

---

## 7. 依赖关系

### 7.1 外部依赖

```json
{
  "dependencies": {
    "winston": "^3.11.0",        // 日志框架（可选，可自行实现）
    "winston-daily-rotate-file": "^4.7.0"
  }
}
```

### 7.2 内部模块依赖

```
日志系统
    ↑
    └──> 配置系统（获取日志配置）
```

### 7.3 启动顺序

```
1. 配置系统
2. 日志系统 ← 第二个启动
3. 其他模块...
```

---

## 8. 配置项

### 8.1 可配置参数

| 路径 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `logging.level` | string | `info` | 全局日志级别 |
| `logging.format` | string | `json` | 日志格式 |
| `logging.dir` | string | `~/.friclaw/logs` | 日志目录 |
| `logging.maxSize` | string | `100m` | 单文件最大大小 |
| `logging.maxFiles` | number | `7` | 保留文件数量 |
| `logging.console` | boolean | `true` | 是否输出到控制台 |

### 8.2 环境变量映射

| 环境变量 | 配置路径 | 说明 |
|----------|----------|------|
| `FRICLAW_LOG_LEVEL` | `logging.level` | 日志级别 |
| `FRICLAW_LOG_FORMAT` | `logging.format` | 日志格式 |
| `FRICLAW_LOG_DIR` | `logging.dir` | 日志目录 |

---

## 9. 监控和日志

### 9.1 关键指标

- 各级别日志数量
- 日志输出速率
- 错误日志占比
- 传输失败次数

### 9.2 日志文件命名

```
~/.friclaw/logs/
├── friclaw.log              # 当前日志
├── friclaw.2026-03-13T10-30-00Z.log  # 轮转日志
├── friclaw.2026-03-13T12-00-00Z.log
└── friclaw.2026-03-13T14-00-00Z.log
```

### 9.3 日志级别建议

| 模块 | 生产环境 | 开发环境 |
|------|----------|----------|
| 网关层 | `info` | `debug` |
| 会话层 | `info` | `debug` |
| Agent 层 | `info` | `debug` |
| 内存层 | `warn` | `info` |
| MCP 框架 | `warn` | `debug` |
| 定时任务 | `info` | `debug` |
| Dashboard | `warn` | `info` |

---

## 10. 安全考虑

### 10.1 敏感信息过滤

```typescript
/**
 * 敏感字段列表
 */
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'session',
  'creditCard',
];

/**
 * 过滤敏感信息
 */
function sanitizeData(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
```

### 10.2 日志权限

```typescript
/**
 * 确保日志目录安全
 */
async function secureLogDir(dir: string): Promise<void> {
  // 创建目录（如果不存在）
  await fs.promises.mkdir(dir, { recursive: true });

  // 设置权限（仅所有者可读写）
  await fs.promises.chmod(dir, 0o700);
}
```

### 10.3 日志注入防护

```typescript
/**
 * 转义特殊字符防止日志注入
 */
function escapeLogString(str: string): string {
  return str
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x1f\x7f]/g, ''); // 移除控制字符
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
