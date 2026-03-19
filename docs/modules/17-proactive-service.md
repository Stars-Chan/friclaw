# 15 主动服务能力

## 目标

让 FriClaw 从被动响应升级为主动感知，基于用户行为模式识别需求，在合适的时机主动提醒或建议。

> 优先级 P2，阶段四实现。

## 核心理念

FRIDAY 不只是回答问题，她会主动说："Boss，你今天有个会议在 3 点，还有 2 小时。"

主动服务的三个层次：
1. **定时提醒**：基于 Cron 任务（已在模块 11 实现）
2. **模式识别**：发现用户的重复行为，主动建议自动化
3. **上下文感知**：根据时间、日历、任务状态主动推送

## 子任务

### 15.1 行为模式识别

分析用户的历史对话，识别重复模式：

```typescript
// src/proactive/pattern-detector.ts
export class PatternDetector {
  // 分析最近 N 条 Episode，提取重复模式
  async detect(episodes: Episode[]): Promise<Pattern[]> {
    const patterns: Pattern[] = []

    // 时间模式：每天同一时间做同一件事
    const timePatterns = this.detectTimePatterns(episodes)
    patterns.push(...timePatterns)

    // 内容模式：重复询问同类问题
    const contentPatterns = this.detectContentPatterns(episodes)
    patterns.push(...contentPatterns)

    return patterns
  }

  private detectTimePatterns(episodes: Episode[]): Pattern[] {
    // 按小时统计各类操作频率
    const hourlyStats = new Map<number, Map<string, number>>()
    for (const ep of episodes) {
      const hour = new Date(ep.date).getHours()
      // 分析 episode 内容，提取操作类型
    }
    // 找出高频时间段
    return []
  }
}
```

### 15.2 主动提醒触发器

```typescript
// src/proactive/reminder.ts
export class ProactiveReminder {
  private scheduler: CronScheduler
  private detector: PatternDetector

  // 每天分析一次用户行为，生成建议
  async analyze(userId: string): Promise<void> {
    const episodes = await this.memory.episode.recent(30)
    const patterns = await this.detector.detect(episodes)

    for (const pattern of patterns) {
      if (pattern.confidence > 0.8 && !this.hasExistingJob(pattern)) {
        // 主动建议创建定时任务
        await this.suggestAutomation(userId, pattern)
      }
    }
  }

  private async suggestAutomation(userId: string, pattern: Pattern): Promise<void> {
    const suggestion = `我注意到你每天 ${pattern.time} 都会${pattern.description}，要不要设置一个定时提醒？`
    await this.dispatcher.sendProactive(userId, suggestion)
  }
}
```

### 15.3 上下文感知

```typescript
// src/proactive/context-aware.ts
export class ContextAwareService {
  // 每小时检查一次上下文
  async check(userId: string): Promise<void> {
    const now = new Date()

    // 工作日早上 9 点：发送今日摘要
    if (isWeekday(now) && now.getHours() === 9) {
      await this.sendDailySummary(userId)
    }

    // 检查未完成的任务
    const pendingTasks = await this.getPendingTasks(userId)
    if (pendingTasks.length > 0) {
      await this.remindPendingTasks(userId, pendingTasks)
    }
  }

  private async sendDailySummary(userId: string): Promise<void> {
    const msg = '早上好！今天有以下事项需要关注：\n' +
      await this.buildDailySummary(userId)
    await this.dispatcher.sendProactive(userId, msg)
  }
}
```

### 15.4 用户偏好学习

记录用户对主动提醒的反馈，调整推送策略：

```typescript
interface ProactivePreference {
  userId: string
  // 接受率（用户对主动提醒的正向反馈比例）
  acceptRate: number
  // 偏好推送时间段
  preferredHours: number[]
  // 勿扰模式
  quietHours: { start: number; end: number } | null
}
```

### 15.5 勿扰模式

```typescript
function shouldSendProactive(pref: ProactivePreference): boolean {
  if (!pref.quietHours) return true

  const hour = new Date().getHours()
  const { start, end } = pref.quietHours

  if (start < end) {
    return hour < start || hour >= end
  } else {
    // 跨午夜
    return hour >= end && hour < start
  }
}
```

### 15.6 主动消息发送

Dispatcher 新增主动发送能力（不依赖用户消息触发）：

```typescript
// src/dispatcher.ts
async sendProactive(userId: string, text: string): Promise<void> {
  // 找到该用户最近活跃的会话
  const session = this.sessionManager.getLatestSession(userId)
  if (!session) return

  const gateway = this.gateways.find(g => g.kind === session.platform)
  if (!gateway) return

  await gateway.send(session.chatId, { text })
}
```

### 15.7 实现优先级

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 每日摘要 | P2 | 每天早上发送今日概览 |
| 模式识别 | P2 | 发现重复行为，建议自动化 |
| 勿扰模式 | P2 | 用户可配置静默时段 |
| 偏好学习 | P3 | 根据反馈调整推送频率 |

## 验收标准

- 每日摘要按时发送
- 识别到重复模式后主动建议
- 勿扰模式期间不发送主动消息
- 用户可通过对话关闭主动服务
