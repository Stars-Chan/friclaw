---
name: refactor-20260327-refactorCronScheduling-Stars-Chan
status: completed
strategy: follow
depends_on: []
---

# 任务列表：重构 Cron 定时任务系统

> 创建时间：2026-03-27

## 阶段 1：基础设施

- [ ] 1.1 添加 croner 依赖
  - 文件：`package.json`
  - 依赖：无

- [ ] 1.2 创建 SQLite 数据库模式
  - 文件：`src/cron/storage.ts`
  - 依赖：1.1
  - 创建 `cron_jobs` 表（id, name, cron_expression, prompt, timezone, enabled, created_at, updated_at）
  - 创建 `cron_executions` 表（id, job_id, scheduled_time, executed_at, status, error_message）

- [ ] 1.3 实现数据库持久化层
  - 文件：`src/cron/storage.ts`
  - 依赖：1.2
  - 实现 CRUD 操作：createJob, getJob, listJobs, updateJob, deleteJob
  - 实现执行历史记录：recordExecution, getExecutionHistory

## 阶段 2：核心实现

- [ ] 2.1 重构 CronScheduler 使用 croner
  - 文件：`src/cron/scheduler.ts`
  - 依赖：阶段 1
  - 移除轮询机制，使用 croner 的事件驱动调度
  - 添加时区支持
  - 实现事件发射器模式（emit 'job:execute' 事件）

- [ ] 2.2 更新 CronScheduler API `[P]`
  - 文件：`src/cron/scheduler.ts`
  - 依赖：2.1
  - 更新 scheduleJob 方法支持时区参数
  - 更新 cancelJob 方法
  - 添加 getJobStatus 和 getExecutionHistory 方法

- [ ] 2.3 移除旧的 JSON 文件持久化 `[P]`
  - 文件：`src/cron/scheduler.ts`
  - 依赖：2.1
  - 删除 loadJobs 和 saveJobs 方法
  - 移除文件系统依赖

## 阶段 3：集成与验证

- [ ] 3.1 更新 MCP Server 适配新 API
  - 文件：`src/cron/mcp-server.ts`
  - 依赖：阶段 2
  - 更新工具调用以使用新的 CronScheduler API
  - 添加时区参数支持
  - 添加执行历史查询工具

- [ ] 3.2 更新初始化逻辑
  - 文件：`src/mcp/cron-entry.ts`
  - 依赖：3.1
  - 初始化 SQLite 存储
  - 从数据库恢复已保存的任务

- [ ] 3.3 更新单元测试
  - 文件：`tests/unit/cron/scheduler.test.ts`
  - 依赖：3.2
  - 使用内存 SQLite 数据库进行测试
  - 测试时区支持
  - 测试执行历史记录

- [ ] 3.4 添加集成测试
  - 文件：`tests/integration/cron.test.ts`
  - 依赖：3.3
  - 测试完整的任务调度流程
  - 测试事件发射和监听

## 检查点

- [ ] 阶段 1 完成，SQLite 存储层就绪
- [ ] 阶段 2 完成，croner 调度器重构完成
- [ ] 阶段 3 完成，集成测试通过

---

`[P]` = 可并行执行

**状态**：🟡 待处理
