import { useState, useEffect } from 'react';
import { Clock, Pencil, Trash2, X } from 'lucide-react';

const API_BASE = window.location.origin.replace(':5173', ':3000');

interface CronJob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  platform: string;
  chatId: string;
  userId: string;
  enabled: boolean;
  timezone?: string;
  createdAt: string;
}

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [error, setError] = useState<string>('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cron/jobs`);
      const data = await res.json();
      setJobs(data.jobs || []);
      setError('');
    } catch (err) {
      setError('加载任务失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此任务？')) return;
    try {
      const res = await fetch(`${API_BASE}/api/cron/jobs/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSave = async (job: Partial<CronJob>) => {
    if (!job.name?.trim() || !job.cronExpression?.trim() || !job.prompt?.trim()) {
      setError('请填写所有必填字段');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/cron/jobs/${editingJob!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditingJob(null);
      setError('');
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const getPlatformBadge = (platform: string) => {
    const badges = {
      dashboard: { bg: 'bg-blue-900', text: 'text-blue-300', label: 'Dashboard' },
      feishu: { bg: 'bg-indigo-900', text: 'text-indigo-300', label: '飞书' },
      weixin: { bg: 'bg-emerald-900', text: 'text-emerald-300', label: '微信' },
      wecom: { bg: 'bg-purple-900', text: 'text-purple-300', label: '企业微信' },
    };
    return badges[platform as keyof typeof badges] || badges.dashboard;
  };

  const parseSchedule = (cronExpression: string) => {
    if (cronExpression.includes('T')) {
      const date = new Date(cronExpression);
      return {
        time: date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        frequency: '单次'
      };
    }

    const parts = cronExpression.split(' ');
    if (parts.length === 5) {
      const [minute, hour] = parts;
      const displayMinute = minute === '*' ? '00' : (minute.startsWith('*/') ? `每${minute.slice(2)}分钟` : minute);
      const displayHour = hour === '*' ? '每小时' : hour;

      if (hour === '*') {
        return { time: displayMinute, frequency: '每小时' };
      }

      return {
        time: typeof displayMinute === 'string' && !displayMinute.includes('每')
          ? `${displayHour}:${displayMinute.padStart(2, '0')}`
          : `${displayHour}:${displayMinute}`,
        frequency: '每天'
      };
    }

    return { time: cronExpression, frequency: '定时' };
  };

  const filteredJobs = platformFilter === 'all' ? jobs : jobs.filter(job => job.platform === platformFilter);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-gray-100">定时任务</h2>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 text-gray-100 rounded border border-gray-700 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="all">全部平台</option>
          <option value="dashboard">Dashboard</option>
          <option value="feishu">飞书</option>
          <option value="weixin">微信</option>
          <option value="wecom">企业微信</option>
        </select>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {filteredJobs.length === 0 ? (
          <div className="text-center text-gray-500 py-12">暂无定时任务</div>
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job) => {
              const platformBadge = getPlatformBadge(job.platform);
              const schedule = parseSchedule(job.cronExpression);
              return (
              <div
                key={job.id}
                className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-blue-400" />
                      <h3 className="text-base font-medium text-gray-100">{job.name}</h3>
                      <span className={`px-2 py-1 text-xs rounded ${job.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                        {job.enabled ? '启用' : '禁用'}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded ${platformBadge.bg} ${platformBadge.text}`}>
                        {platformBadge.label}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-gray-400">
                      <div>执行时间: {schedule.time} | 频率: {schedule.frequency}</div>
                      <div className="mt-1">提示词: {job.prompt.slice(0, 60)}{job.prompt.length > 60 ? '...' : ''}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingJob(job)}
                      className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {editingJob && (
        <CronEditDialog
          job={editingJob}
          onSave={handleSave}
          onClose={() => setEditingJob(null)}
        />
      )}
    </div>
  );
}

interface CronEditDialogProps {
  job: CronJob | null;
  onSave: (job: Partial<CronJob>) => void;
  onClose: () => void;
}

function CronEditDialog({ job, onSave, onClose }: CronEditDialogProps) {
  const [form, setForm] = useState({
    name: job?.name || '',
    cronExpression: job?.cronExpression || '',
    prompt: job?.prompt || '',
    platform: job?.platform || 'dashboard',
    chatId: job?.chatId || '',
    userId: job?.userId || '',
    enabled: job?.enabled ?? true,
    timezone: job?.timezone || 'Asia/Shanghai',
  });
  const [targets, setTargets] = useState<Array<{ chatId: string; userId: string; label: string }>>([]);

  useEffect(() => {
    loadTargets(form.platform);
  }, [form.platform]);

  const loadTargets = async (platform: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/cron/targets?platform=${platform}`);
      const data = await res.json();
      setTargets(data.targets || []);
    } catch (err) {
      console.error('Failed to load targets:', err);
    }
  };

  const handleTargetChange = (chatId: string) => {
    const target = targets.find(t => t.chatId === chatId);
    if (target) {
      setForm({ ...form, chatId: target.chatId, userId: target.userId });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-gray-100">{job ? '编辑任务' : '新建任务'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">任务名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Cron表达式</label>
            <input
              type="text"
              value={form.cronExpression}
              onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
              placeholder="定时: 0 9 * * * (每天9点) | 一次性: 2026-03-30T15:00:00"
              className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">定时任务使用cron格式，一次性任务使用ISO时间</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">提示词</label>
            <textarea
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">平台</label>
            <div className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600">
              {form.platform === 'dashboard' ? 'Dashboard' : form.platform === 'feishu' ? '飞书' : form.platform === 'weixin' ? '微信' : '企业微信'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">目标会话</label>
            <div className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600">
              {form.chatId}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">时区</label>
            <input
              type="text"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4"
            />
            <label className="text-sm text-gray-300">启用任务</label>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:bg-gray-700 rounded"
          >
            取消
          </button>
          <button
            onClick={() => onSave(form)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
