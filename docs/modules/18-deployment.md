# 18 部署架构 (Docker + 单机)

## 目标

提供单机直接运行和 Docker 容器两种部署方式，数据目录统一挂载持久化，支持环境变量注入敏感配置。

## 核心概念

```
~/.friclaw/
├── config.json       # 主配置（支持 ${ENV_VAR} 占位符）
├── memory/           # SQLite 记忆数据库
├── workspaces/       # 会话工作空间
├── logs/             # 日志文件
└── cache/            # 缓存数据
```

## 子任务

### 18.1 单机部署脚本

```bash
# 安装依赖
bun install

# 初始化配置目录
mkdir -p ~/.friclaw/{memory,workspaces,logs,cache}
cp config.example.json ~/.friclaw/config.json

# 启动
bun run src/index.ts --config ~/.friclaw/config.json
```

`package.json` 补充启动脚本：

```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch src/index.ts"
  }
}
```

### 18.2 Dockerfile

```dockerfile
FROM oven/bun:1.1 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1.1-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
VOLUME ["/data/memory", "/data/workspaces", "/data/logs", "/data/cache"]

CMD ["bun", "dist/index.js", "--config", "/data/config.json"]
```

### 18.3 docker-compose.yml

```yaml
services:
  friclaw:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data/config.json:/data/config.json:ro
      - ./data/memory:/data/memory
      - ./data/workspaces:/data/workspaces
      - ./data/logs:/data/logs
      - ./data/cache:/data/cache
      - ~/.claude:/root/.claude:ro   # Claude Code 认证
    environment:
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
      - FEISHU_ENCRYPT_KEY=${FEISHU_ENCRYPT_KEY}
      - WECOM_BOT_ID=${WECOM_BOT_ID}
      - WECOM_SECRET=${WECOM_SECRET}
      - LOG_LEVEL=${LOG_LEVEL:-info}
```

### 18.4 健康检查

```typescript
// src/index.ts — HTTP 健康检查端点
Bun.serve({
  port: config.dashboard.port,
  fetch(req) {
    if (new URL(req.url).pathname === '/health') {
      return Response.json({ status: 'ok', version: pkg.version, uptime: process.uptime() })
    }
    return dashboardHandler(req)
  },
})
```

### 18.5 config.example.json

```json
{
  "agent": {
    "model": "claude-sonnet-4-6",
    "summaryModel": "claude-haiku-4-5"
  },
  "gateways": {
    "feishu": {
      "appId": "${FEISHU_APP_ID}",
      "appSecret": "${FEISHU_APP_SECRET}",
      "encryptKey": "${FEISHU_ENCRYPT_KEY}"
    },
    "wecom": {
      "botId": "${WECOM_BOT_ID}",
      "secret": "${WECOM_SECRET}"
    }
  },
  "memory": {
    "dir": "/data/memory",
    "vectorEnabled": false
  },
  "workspaces": {
    "dir": "/data/workspaces",
    "sessionTimeout": 3600
  },
  "logging": { "level": "info", "dir": "/data/logs" },
  "dashboard": { "enabled": true, "port": 3000 }
}
```

## 验收标准

- `bun start` 单机可直接启动
- `docker compose up` 容器启动后 `/health` 返回 200
- 重启容器后记忆、工作空间数据不丢失
- 环境变量占位符正确替换，敏感信息不写入代码
