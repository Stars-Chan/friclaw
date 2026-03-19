# 12 智能路由

## 目标

根据消息复杂度自动选择合适的模型，在保证质量的前提下降低 API 成本。

## 路由策略

```
消息输入
  → 复杂度分析
  → 选择模型
  → 转发给 Claude Code Agent
```

## 子任务

### 12.1 复杂度分类

| 级别 | 判断依据 | 模型 |
|------|---------|------|
| simple | 短文本、无代码、无多步骤 | claude-haiku-4-5 |
| medium | 中等长度、有代码 | claude-sonnet-4-6 |
| complex | 多步骤推理、分析评估 | claude-opus-4-6 |

### 12.2 分类器实现

```typescript
// src/agent/router.ts
export function classifyComplexity(text: string): 'simple' | 'medium' | 'complex' {
  const lower = text.toLowerCase()

  // 复杂度信号
  const hasCode = /```|`[^`]+`/.test(text)
  const hasMultiStep = /步骤|流程|分析|评估|对比|总结|报告/.test(lower)
  const hasReasoning = /为什么|原因|如何|怎么|建议|方案/.test(lower)
  const isLong = text.length > 500

  if (hasMultiStep || (hasReasoning && isLong)) return 'complex'
  if (hasCode || isLong || hasReasoning) return 'medium'
  return 'simple'
}
```

### 12.3 模型映射配置

```typescript
// config.json
{
  "routing": {
    "enabled": true,
    "models": {
      "simple": "claude-haiku-4-5",
      "medium": "claude-sonnet-4-6",
      "complex": "claude-opus-4-6"
    }
  }
}
```

### 12.4 在 Dispatcher 中集成

```typescript
// src/dispatcher.ts
async handle(msg: InboundMessage): Promise<void> {
  const complexity = this.config.routing.enabled
    ? classifyComplexity(msg.text)
    : 'medium'

  const model = this.config.routing.models[complexity]
  const agent = this.agents.get('claude_code')!

  await agent.stream({ ...msg, model })
}
```

### 12.5 路由统计

记录各模型使用频率，供 Dashboard 展示成本分析：

```typescript
interface RoutingStats {
  simple: number
  medium: number
  complex: number
  totalMessages: number
  estimatedCostSaved: number // 相比全用 opus 节省的成本
}
```

## 验收标准

- 简单问候使用 haiku，复杂分析使用 opus
- 路由可通过配置关闭（全部使用默认模型）
- Dashboard 展示路由统计
