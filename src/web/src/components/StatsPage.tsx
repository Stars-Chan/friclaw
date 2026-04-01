import { useState, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';

interface TokenUsage {
  timestamp: number;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  costCny?: number;
}

interface DailyStats {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  count: number;
}

export function StatsPage() {
  const [stats, setStats] = useState<TokenUsage[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stats/tokens?days=${days}`)
      .then(res => res.json())
      .then(data => {
        setStats(data.stats || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [days]);

  const dailyStats: DailyStats[] = [];
  const statsMap = new Map<string, DailyStats>();

  stats.forEach(usage => {
    const date = new Date(usage.timestamp).toLocaleDateString('zh-CN');
    const existing = statsMap.get(date) || {
      date,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      count: 0,
    };

    existing.inputTokens += usage.inputTokens;
    existing.outputTokens += usage.outputTokens;
    existing.totalTokens += usage.inputTokens + usage.outputTokens;
    existing.cost += usage.costCny || 0;
    existing.count += 1;
    statsMap.set(date, existing);
  });

  statsMap.forEach(stat => dailyStats.push(stat));
  dailyStats.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalInput = stats.reduce((sum, s) => sum + s.inputTokens, 0);
  const totalOutput = stats.reduce((sum, s) => sum + s.outputTokens, 0);
  const totalCost = stats.reduce((sum, s) => sum + (s.costCny || 0), 0);

  if (loading) return <div className="text-gray-400">加载中...</div>;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
          <BarChart3 className="w-6 h-6" />
          Token 使用统计
        </h3>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300"
        >
          <option value={1}>最近 1 天</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="text-sm text-gray-400 mb-1">输入 Token</div>
          <div className="text-2xl font-semibold text-blue-400">{totalInput.toLocaleString()}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="text-sm text-gray-400 mb-1">输出 Token</div>
          <div className="text-2xl font-semibold text-green-400">{totalOutput.toLocaleString()}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="text-sm text-gray-400 mb-1">总费用</div>
          <div className="text-2xl font-semibold text-yellow-400">¥{totalCost.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="text-lg font-medium text-gray-200 mb-4">每日统计</h4>
        <div className="space-y-2">
          {dailyStats.map(stat => (
            <div key={stat.date} className="flex items-center gap-4 text-sm">
              <div className="w-24 text-gray-400">{stat.date}</div>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 bg-gray-900 rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-blue-500 h-full"
                    style={{ width: `${(stat.inputTokens / Math.max(...dailyStats.map(s => s.totalTokens))) * 100}%` }}
                  />
                </div>
                <div className="w-32 text-gray-300">{stat.totalTokens.toLocaleString()} tokens</div>
                <div className="w-20 text-yellow-400">¥{stat.cost.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
