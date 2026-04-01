import { useState, useEffect } from 'react';
import { Save, Plus, X, Check } from 'lucide-react';

interface ConfigItem {
  [key: string]: string;
}

interface Config {
  current: ConfigItem;
  saved: ConfigItem[];
}

const CONFIG_FIELDS = [
  { key: 'name', label: '配置名称' },
  { key: 'ANTHROPIC_AUTH_TOKEN', label: 'Auth Token', type: 'password' },
  { key: 'ANTHROPIC_BASE_URL', label: 'Base URL' },
  { key: 'API_TIMEOUT_MS', label: 'Timeout (ms)' },
  { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', label: 'Haiku Model' },
  { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', label: 'Sonnet Model' },
  { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', label: 'Opus Model' },
];

const PRICING_FIELDS = [
  { key: 'TOKEN_PRICE_INPUT', label: '输入 Token 价格 (¥/1M)', placeholder: '3.00' },
  { key: 'TOKEN_PRICE_OUTPUT', label: '输出 Token 价格 (¥/1M)', placeholder: '15.00' },
];

export function ConfigPage() {
  const [config, setConfig] = useState<Config>({ current: {}, saved: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(res => {
        if (!res.ok) {
          throw new Error(`加载配置失败: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        setConfig({
          current: data.env || {},
          saved: data.saved || [],
        });
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load config:', err);
        setError('加载配置失败，请刷新页面重试');
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: config.current }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${response.status}`);
      }

      setSuccess('配置已成功应用');
      // 3秒后自动清除成功提示
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const addToSaved = async () => {
    setError(null);
    setSuccess(null);

    const newSaved = [...config.saved, { ...config.current }];

    try {
      const response = await fetch('/api/config/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved: newSaved }),
      });

      if (!response.ok) {
        throw new Error(`保存失败: ${response.status}`);
      }

      setConfig({ ...config, saved: newSaved });
      setSuccess('配置已保存');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
      setError('保存失败，请稍后重试');
      // 恢复原来的 saved 列表
      setConfig(prev => ({ ...prev, saved: config.saved }));
    }
  };

  const removeSaved = async (index: number) => {
    setError(null);
    setSuccess(null);

    const newSaved = config.saved.filter((_, i) => i !== index);

    try {
      const response = await fetch('/api/config/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved: newSaved }),
      });

      if (!response.ok) {
        throw new Error(`删除失败: ${response.status}`);
      }

      setConfig({ ...config, saved: newSaved });
      setSuccess('配置已删除');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to remove config:', err);
      setError('删除失败，请稍后重试');
      // 恢复原来的 saved 列表
      setConfig(prev => ({ ...prev, saved: config.saved }));
    }
  };

  const loadSaved = (index: number) => {
    setConfig({ ...config, current: { ...config.saved[index] } });
  };

  const updateCurrent = (key: string, value: string) => {
    setConfig({ ...config, current: { ...config.current, [key]: value } });
  };

  if (loading) {
    return <div className="text-gray-400">加载中...</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* 错误提示 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            ×
          </button>
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <span>{success}</span>
          <button
            onClick={() => setSuccess(null)}
            className="ml-auto text-green-400 hover:text-green-300"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-100">模型基础配置</h3>
        <div className="flex gap-2">
          <button
            onClick={addToSaved}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" />
            保存为配置
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg text-sm"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '应用配置'}
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="text-lg font-medium text-gray-200 mb-3">当前配置</h4>
        <div className="space-y-3">
          {CONFIG_FIELDS.map(field => (
            <div key={field.key}>
              <label className="block text-sm text-gray-400 mb-1">{field.label}</label>
              <input
                type={(field as any).type || 'text'}
                value={config.current[field.key] || ''}
                onChange={(e) => updateCurrent(field.key, e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="text-lg font-medium text-gray-200 mb-3">Token 价格配置</h4>
        <div className="space-y-3">
          {PRICING_FIELDS.map(field => (
            <div key={field.key}>
              <label className="block text-sm text-gray-400 mb-1">{field.label}</label>
              <input
                type="text"
                value={config.current[field.key] || ''}
                onChange={(e) => updateCurrent(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300"
              />
            </div>
          ))}
        </div>
      </div>

      {config.saved.length > 0 && (
        <div>
          <h4 className="text-lg font-medium text-gray-200 mb-3">已保存的配置</h4>
          <div className="space-y-2">
            {config.saved.map((item, index) => (
              <div key={index} className="flex items-center gap-2 bg-gray-800 rounded-lg p-3 border border-gray-700">
                <button
                  onClick={() => loadSaved(index)}
                  className="flex-1 text-left text-sm text-gray-300 hover:text-white"
                >
                  {item.name || item.ANTHROPIC_BASE_URL || `配置 #${index + 1}`}
                </button>
                <button
                  onClick={() => loadSaved(index)}
                  className="p-1 hover:bg-gray-700 rounded"
                >
                  <Check className="w-4 h-4 text-green-400" />
                </button>
                <button
                  onClick={() => removeSaved(index)}
                  className="p-1 hover:bg-gray-700 rounded"
                >
                  <X className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
