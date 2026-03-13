# 09. 定时任务模块

> FriClaw 定时任务模块详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

定时任务模块负责管理定时执行的任务，支持一次性任务和循环任务，使用 cron 表达式调度。

**核心功能**:
- 一次性任务调度
- Cron 循环任务调度
- 任务创建/更新/删除
- 任务执行历史
- 并发控制
- 时区支持

---

## 2. 核心接口

```typescript
interface ICronManager {
  // 任务管理
  createJob(config: CronJobConfig): Promise<string>;
  updateJob(jobId: string, updates: Partial<CronJobConfig>): Promise<void>;
  deleteJob(jobId: string): Promise<void>;

  // 查询
  getJob(jobId: string): CronJob | null;
  listJobs(includeDisabled: boolean): CronJob[];

  // 执行
  pauseJob(jobId: string): Promise<void>;
  resumeJob(jobId: string): Promise<void>;
  runJob(jobId: string): Promise<void>;

  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface CronJobConfig {
  label?: string;
  enabled: boolean;
  runAt?: Date;
  cronExpr?: string;
  message: string;
}

interface CronJob {
  id: string;
  label?: string;
  enabled: boolean;
  runAt?: Date;
  cronExpr?: string;
  message: string;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  createdAt: Date;
}
```

---

## 3. 数据结构

```typescript
// Cron 表达式格式
// ┌───────────── 分钟 (0 - 59)
// │ ┌─────────── 小时 (0 - 23)
// │ │ ┌───────── 日期 (1 - 31)
// │ │ │ ┌─────── 月份 (1 - 12)
// │ │ │ │ ┌───── 星期 (0 - 6, 0=周日)
// │ │ │ │ │
// * * * * * *
```

---

## 4. 配置项

```json
{
  "cron": {
    "enabled": true,
    "scheduler": "node-cron",
    "maxConcurrentJobs": 10,
    "timezone": "Asia/Shanghai"
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
