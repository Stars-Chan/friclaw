# 08. 工作空间模块

> FriClaw 工作空间模块详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: ✅ 已完成（在会话层中实现）

---

## 1. 概述

### 1.1 模块职责

工作空间模块负责管理每个会话的独立目录结构和文件，提供会话级别的持久化和隔离。

**说明**: 工作空间管理已在会话层（04-session.md）中详细实现，本文档作为补充说明。

### 1.2 与其他模块的关系

```
工作空间
    ↑
    ├──> 配置系统（获取配置）
    └──> 会话层（被使用）
```

---

## 2. 目录结构

```
~/.friclaw/workspaces/
├── {session_id}/
│   ├── .friclaw/
│   │   ├── session.json      # 会话元数据
│   │   ├── context.json      # 对话上下文
│   │   └── tools.json        # 可用工具配置
│   ├── memory/
│   │   ├── 2026-03-10.md   # 按日期的消息记录
│   │   ├── 2026-03-11.md
│   │   └── 2026-03-12.md
│   ├── temp/
│   │   └── {task_id}/        # 临时任务文件
│   └── cache/
│       ├── {key}/            # 缓存数据
│       └── ...
├── session_1773318288708_h033tgv5dvn/
├── session_1773318288709_wgerz7i8f7e/
└── ...
```

---

## 3. 文件格式

### 3.1 session.json

```json
{
  "id": "feishu:user123:chat456",
  "userId": "user123",
  "chatId": "chat456",
  "platform": "feishu",
  "createdAt": "2026-03-13T10:00:00.000Z",
  "lastActivity": "2026-03-13T15:30:00.000Z"
}
```

### 3.2 context.json

```json
{
  "userId": "user123",
  "userName": "张三",
  "chatId": "chat456",
  "platform": "feishu",
  "chatType": "private",
  "metadata": {},
  "messageCount": 42,
  "lastMessageTime": "2026-03-13T15:30:00.000Z"
}
```

### 3.3 tools.json

```json
{
  "allowedTools": [
    "memory_search",
    "memory_read",
    "cron_list"
  ],
  "availableTools": [
    {
      "name": "memory_search",
      "description": "搜索记忆条目",
      "server": "friclaw-memory"
    }
  ]
}
```

### 3.4 记忆文件格式

```markdown
## FriClaw 会话记录

**日期**: 2026-03-13
**会话**: feishu:user123:chat456

---

## [User] 2026-03-13T10:00:00.000Z

你好，帮我写一个 Python 函数来排序列表。

---

## [Assistant] 2026-03-13T10:00:05.000Z

好的，这里是一个简单的 Python 排序函数：

```python
def sort_list(items):
    return sorted(items)

# 使用示例
my_list = [3, 1, 4, 1, 5, 9]
sorted_list = sort_list(my_list)
print(sorted_list)  # [1, 1, 3, 4, 5, 9]
```

---

## [User] 2026-03-13T10:05:00.000Z

能用冒泡排序实现吗？

---

## [Assistant] 2026-03-13T10:05:05.000Z

当然可以，这是冒泡排序的实现：

```python
def bubble_sort(items):
    n = len(items)
    for i in range(n):
        for j in range(0, n-i-1):
            if items[j] > items[j+1]:
                items[j], items[j+1] = items[j+1], items[j]
    return items
```

冒泡排序的时间复杂度是 O(n²)，适合小规模数据。
```

---

## 4. API 参考

工作空间 API 已在会话层文档（04-session.md）中详细定义。

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
