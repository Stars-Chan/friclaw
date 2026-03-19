# 14 向量检索

## 目标

在 SQLite FTS5 的基础上，引入向量检索能力，提升记忆搜索的语义理解精度。

> 优先级 P2，MVP 阶段不实现，待核心功能稳定后再引入。

## 背景

FTS5 基于关键词匹配，无法处理语义相似但用词不同的情况。例如：
- 用户问"我喜欢吃什么"，但记忆里存的是"偏好：川菜"
- FTS5 无法匹配，向量检索可以

## 子任务

### 14.1 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 向量数据库 | Qdrant | 本地部署，性能好 |
| Embedding 模型 | text-embedding-3-large | OpenAI，效果好 |
| 备选 Embedding | bge-large-zh-v1.5 | 本地模型，无需 API |

### 14.2 Qdrant 本地部署

```bash
# Docker 启动
docker run -d -p 6333:6333 qdrant/qdrant

# 或直接下载二进制
./qdrant --config-path config.yaml
```

### 14.3 VectorStore 实现

```typescript
// src/memory/vector-store.ts
import { QdrantClient } from '@qdrant/js-client-rest'

export class VectorStore {
  private client: QdrantClient
  private collectionName = 'friclaw_memory'
  private dimension = 3072 // text-embedding-3-large

  async init(): Promise<void> {
    await this.client.createCollection(this.collectionName, {
      vectors: { size: this.dimension, distance: 'Cosine' }
    })
  }

  async upsert(id: string, text: string, payload: Record<string, unknown>): Promise<void> {
    const vector = await this.embed(text)
    await this.client.upsert(this.collectionName, {
      points: [{ id, vector, payload }]
    })
  }

  async search(query: string, limit = 10, filter?: object): Promise<SearchResult[]> {
    const vector = await this.embed(query)
    const results = await this.client.search(this.collectionName, {
      vector, limit, filter, with_payload: true
    })
    return results.map(r => ({ id: String(r.id), score: r.score, payload: r.payload }))
  }

  private async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text-embedding-3-large', input: text })
    })
    const data = await res.json()
    return data.data[0].embedding
  }
}
```

### 14.4 混合检索

结合 FTS5 关键词检索和向量语义检索，取并集后按相关度排序：

```typescript
// src/memory/manager.ts
async hybridSearch(query: string, limit = 10): Promise<SearchResult[]> {
  const [ftsResults, vectorResults] = await Promise.all([
    this.ftsSearch(query, limit),
    this.vectorStore?.search(query, limit) ?? [],
  ])

  // 合并去重，向量结果权重更高
  const merged = mergeAndRank(ftsResults, vectorResults)
  return merged.slice(0, limit)
}
```

### 14.5 增量索引

每次保存记忆时，同步更新向量索引：

```typescript
// 在 KnowledgeMemory.save() 中
async save(topic: string, content: string): Promise<void> {
  // 1. 写文件
  this.writeFile(topic, content)
  // 2. 更新 FTS 索引
  this.indexFts(topic, content)
  // 3. 更新向量索引（如果启用）
  if (this.vectorStore) {
    await this.vectorStore.upsert(`knowledge/${topic}`, content, { category: 'knowledge', topic })
  }
}
```

### 14.6 成本控制

- 缓存 Embedding 结果，相同文本不重复调用
- 只对 Knowledge 和 Episode 建立向量索引，Identity 不需要
- 批量 Embedding（每次最多 100 条）

### 14.7 降级策略

Qdrant 不可用时，自动降级到 FTS5：

```typescript
async search(query: string): Promise<SearchResult[]> {
  if (!this.vectorStore || !this.config.vectorEnabled) {
    return this.ftsSearch(query)
  }
  try {
    return await this.hybridSearch(query)
  } catch {
    logger.warn('向量检索失败，降级到 FTS5')
    return this.ftsSearch(query)
  }
}
```

## 验收标准

- 语义相似的记忆能被正确检索
- Qdrant 不可用时自动降级
- Embedding 缓存生效，重复查询不重复调用 API
- 向量索引与文件系统保持同步
