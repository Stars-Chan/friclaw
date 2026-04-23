import { useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';

const DEFAULT_PREFERENCE = {
  enabled: false,
  remindersEnabled: true,
  dailySummaryEnabled: true,
  patternSuggestionsEnabled: true,
  reminderIntervalMinutes: 180,
  dailySummaryHour: 9,
};

type ProactivePreference = Awaited<ReturnType<typeof fetchProactiveState>>['preference'];
type ProactiveInsight = Awaited<ReturnType<typeof fetchProactiveState>>['insights'][number];

async function fetchProactiveState() {
  const res = await fetch('/api/proactive');
  const data = await res.json();
  return {
    preference: data.preference || DEFAULT_PREFERENCE,
    insights: data.insights || [],
  };
}

export function ProactivePage() {
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preference, setPreference] = useState<ProactivePreference>(DEFAULT_PREFERENCE);
  const [insights, setInsights] = useState<ProactiveInsight[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  const load = async () => {
    const data = await fetchProactiveState();
    setPreference(data.preference);
    setInsights(data.insights);
  };

  useEffect(() => {
    load();
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const showSuccess = (message: string) => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    setSuccess(message);
    successTimeoutRef.current = setTimeout(() => setSuccess(''), 2000);
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/proactive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preference),
    });
    const data = await res.json();
    setPreference(data.preference || preference);
    setInsights(data.insights || insights);
    setSaving(false);
    showSuccess('主动服务配置已保存');
  };

  const runNow = async () => {
    const res = await fetch('/api/proactive/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'dashboard_user' }),
    });
    const data = await res.json();
    setInsights(data.insights || []);
    showSuccess('已执行一次主动分析');
  };

  return (
    <div className="max-w-5xl space-y-4">
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-2 rounded-lg">
          {success}
        </div>
      )}

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-100 font-medium">
            <Bell className="w-4 h-4" />
            主动服务偏好
          </div>
          <div className="flex gap-2">
            <button onClick={runNow} className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-100 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              立即运行
            </button>
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-sm text-white">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <label className="flex items-center gap-2 text-gray-300">
            <input type="checkbox" checked={preference.enabled} onChange={(e) => setPreference({ ...preference, enabled: e.target.checked })} />
            启用主动服务
          </label>
          <label className="flex items-center gap-2 text-gray-300">
            <input type="checkbox" checked={preference.remindersEnabled} onChange={(e) => setPreference({ ...preference, remindersEnabled: e.target.checked })} />
            启用提醒
          </label>
          <label className="flex items-center gap-2 text-gray-300">
            <input type="checkbox" checked={preference.dailySummaryEnabled} onChange={(e) => setPreference({ ...preference, dailySummaryEnabled: e.target.checked })} />
            启用每日复盘
          </label>
          <label className="flex items-center gap-2 text-gray-300">
            <input type="checkbox" checked={preference.patternSuggestionsEnabled} onChange={(e) => setPreference({ ...preference, patternSuggestionsEnabled: e.target.checked })} />
            启用模式建议
          </label>
          <label className="text-gray-300">
            提醒间隔（分钟）
            <input type="number" value={preference.reminderIntervalMinutes} onChange={(e) => setPreference({ ...preference, reminderIntervalMinutes: Number(e.target.value) || 0 })} className="mt-1 w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-100" />
          </label>
          <label className="text-gray-300">
            每日复盘小时
            <input type="number" min={0} max={23} value={preference.dailySummaryHour} onChange={(e) => setPreference({ ...preference, dailySummaryHour: Number(e.target.value) || 0 })} className="mt-1 w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-100" />
          </label>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-gray-100 font-medium mb-3">主动服务输出</h3>
        <div className="space-y-3">
          {insights.length === 0 ? (
            <div className="text-gray-500 text-sm">暂无主动输出</div>
          ) : insights.map((item) => (
            <div key={item.id} className="rounded border border-gray-700 bg-gray-900 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-gray-100 font-medium">{item.title}</div>
                <div className="text-xs text-gray-500">{new Date(item.createdAt).toLocaleString('zh-CN')}</div>
              </div>
              <div className="text-xs text-blue-300 mt-1">{item.kind}</div>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-300 font-sans">{item.content}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
