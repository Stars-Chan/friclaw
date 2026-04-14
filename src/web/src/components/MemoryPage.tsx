import { useState, useEffect } from 'react';
import { Brain, FileText, Clock, Save } from 'lucide-react';

type MemoryType = 'identity' | 'knowledge' | 'episodes';

type KnowledgeSummary = {
  id: string;
  title: string;
  tags: string[];
  domain: string;
  status: string;
  confidence: string;
  updatedAt: string;
};

export function MemoryPage() {
  const [activeType, setActiveType] = useState<MemoryType>('identity');
  const [identityContent, setIdentityContent] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeSummary[]>([]);
  const [selectedKnowledge, setSelectedKnowledge] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (activeType === 'identity') {
      fetch('/api/memory/identity')
        .then(res => res.json())
        .then(data => setIdentityContent(data.content || ''));
    } else if (activeType === 'knowledge') {
      fetch('/api/memory/knowledge')
        .then(res => res.json())
        .then(data => {
          const list = data.list || [];
          setKnowledgeList(list);
          setSelectedKnowledge((current) => {
            if (current && list.some((item: KnowledgeSummary) => item.id === current)) {
              return current;
            }
            setKnowledgeContent('');
            return '';
          });
        });
    } else if (activeType === 'episodes') {
      fetch('/api/memory/episodes')
        .then(res => res.json())
        .then(data => setEpisodes(data.episodes || []));
    }
  }, [activeType]);

  useEffect(() => {
    if (selectedKnowledge) {
      fetch(`/api/memory/knowledge/${encodeURIComponent(selectedKnowledge)}`)
        .then(res => res.json())
        .then(data => setKnowledgeContent(data.content || ''));
    } else {
      setKnowledgeContent('');
    }
  }, [selectedKnowledge]);

  const saveIdentity = async () => {
    setSaving(true);
    await fetch('/api/memory/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: identityContent }),
    });
    setSaving(false);
    setSuccess('身份记忆已保存');
    setTimeout(() => setSuccess(''), 2000);
  };

  const saveKnowledge = async () => {
    if (!selectedKnowledge) return;
    setSaving(true);
    await fetch(`/api/memory/knowledge/${encodeURIComponent(selectedKnowledge)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: knowledgeContent }),
    });
    setSaving(false);
    setSuccess('知识记忆已保存');
    setTimeout(() => setSuccess(''), 2000);
  };

  return (
    <div className="max-w-5xl space-y-4">
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-2 rounded-lg">
          {success}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setActiveType('identity')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            activeType === 'identity' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
          }`}
        >
          <Brain className="w-4 h-4" />
          身份记忆
        </button>
        <button
          onClick={() => setActiveType('knowledge')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            activeType === 'knowledge' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
          }`}
        >
          <FileText className="w-4 h-4" />
          知识记忆
        </button>
        <button
          onClick={() => setActiveType('episodes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            activeType === 'episodes' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
          }`}
        >
          <Clock className="w-4 h-4" />
          情景记忆
        </button>
      </div>

      {activeType === 'identity' && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-lg font-medium text-gray-200">身份记忆 (SOUL.md)</h4>
            <button
              onClick={saveIdentity}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
          <textarea
            value={identityContent}
            onChange={(e) => setIdentityContent(e.target.value)}
            className="w-full h-96 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 font-mono"
          />
        </div>
      )}

      {activeType === 'knowledge' && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h4 className="text-sm font-medium text-gray-200 mb-2">知识列表</h4>
            <div className="space-y-1">
              {knowledgeList.map((topic) => (
                <div
                  key={topic.id}
                  onClick={() => setSelectedKnowledge(topic.id)}
                  className={`px-2 py-2 rounded cursor-pointer text-sm ${
                    selectedKnowledge === topic.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'
                  }`}
                >
                  <div className="font-medium">{topic.title || topic.id}</div>
                  <div className="text-xs opacity-70">{topic.id}.md</div>
                </div>
              ))}
            </div>
          </div>
          <div className="col-span-3 bg-gray-800 rounded-lg p-4 border border-gray-700">
            {selectedKnowledge ? (
              <>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-lg font-medium text-gray-200">{selectedKnowledge}.md</h4>
                  <button
                    onClick={saveKnowledge}
                    disabled={saving}
                    className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
                <textarea
                  value={knowledgeContent}
                  onChange={(e) => setKnowledgeContent(e.target.value)}
                  className="w-full h-96 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 font-mono"
                />
              </>
            ) : (
              <div className="text-gray-400 text-center py-20">选择一个知识文件查看</div>
            )}
          </div>
        </div>
      )}

      {activeType === 'episodes' && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h4 className="text-lg font-medium text-gray-200 mb-3">情景记忆</h4>
          <div className="space-y-2">
            {episodes.map(ep => (
              <div key={ep.id} className="bg-gray-900 rounded p-3 border border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <span>{ep.date}</span>
                  {ep.tags.length > 0 && <span>· {ep.tags.join(', ')}</span>}
                </div>
                <div className="text-sm text-gray-300">{ep.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
