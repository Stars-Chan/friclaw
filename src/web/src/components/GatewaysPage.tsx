import { useState, useEffect } from 'react';
import { Save, Radio } from 'lucide-react';

interface GatewayConfig {
  enabled: boolean;
  [key: string]: any;
}

interface GatewaysConfig {
  feishu: GatewayConfig;
  wecom: GatewayConfig;
  weixin: GatewayConfig;
}

const GATEWAY_FIELDS: Record<string, { label: string; fields: { key: string; label: string; type?: string }[] }> = {
  feishu: {
    label: '飞书',
    fields: [
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', type: 'password' },
      { key: 'encryptKey', label: 'Encrypt Key', type: 'password' },
      { key: 'verificationToken', label: 'Verification Token', type: 'password' },
    ],
  },
  wecom: {
    label: '企业微信',
    fields: [
      { key: 'botId', label: 'Bot ID' },
      { key: 'secret', label: 'Secret', type: 'password' },
    ],
  },
  weixin: {
    label: '微信',
    fields: [
      { key: 'token', label: 'Token', type: 'password' },
    ],
  },
};

export function GatewaysPage() {
  const [gateways, setGateways] = useState<GatewaysConfig>({
    feishu: { enabled: false },
    wecom: { enabled: false },
    weixin: { enabled: false },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/gateways')
      .then(res => {
        if (!res.ok) throw new Error(`加载网关配置失败: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setGateways({
          feishu: data.gateways?.feishu || { enabled: false },
          wecom: data.gateways?.wecom || { enabled: false },
          weixin: data.gateways?.weixin || { enabled: false },
        });
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load gateways:', err);
        setError('加载网关配置失败，请刷新页面重试');
        setLoading(false);
      });
  }, []);

  const updateGateway = (gateway: keyof GatewaysConfig, key: string, value: any) => {
    setGateways(prev => ({
      ...prev,
      [gateway]: { ...prev[gateway], [key]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateways }),
      });

      if (!response.ok) {
        throw new Error(`保存网关配置失败: ${response.status}`);
      }

      setSuccess('网关配置已成功应用');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to save gateways:', err);
      setError(err instanceof Error ? err.message : '保存网关配置失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400">加载中...</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">×</button>
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-400 hover:text-green-300">×</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
          <Radio className="w-5 h-5" />
          网关配置
        </h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg text-sm"
        >
          <Save className="w-4 h-4" />
          {saving ? '应用中...' : '应用配置'}
        </button>
      </div>

      {(Object.keys(GATEWAY_FIELDS) as (keyof GatewaysConfig)[]).map(gateway => {
        const def = GATEWAY_FIELDS[gateway];
        const gw = gateways[gateway];
        return (
          <div key={gateway} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-medium text-gray-200">{def.label}</h4>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-gray-400">{gw.enabled ? '已启用' : '已禁用'}</span>
                <input
                  type="checkbox"
                  checked={gw.enabled || false}
                  onChange={(e) => updateGateway(gateway, 'enabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500"
                />
              </label>
            </div>
            {gw.enabled && (
              <div className="space-y-3">
                {def.fields.map(field => (
                  <div key={field.key}>
                    <label className="block text-sm text-gray-400 mb-1">{field.label}</label>
                    <input
                      type={field.type || 'text'}
                      value={gw[field.key] || ''}
                      onChange={(e) => updateGateway(gateway, field.key, e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
