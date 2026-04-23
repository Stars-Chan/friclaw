import { useEffect, useRef, useState } from 'react';
import { Brain, FileText, Clock, Save, GitBranch, CheckCircle2, PauseCircle, Archive } from 'lucide-react';

type MemoryType = 'identity' | 'knowledge' | 'episodes' | 'candidates';

type KnowledgeSummary = {
  id: string;
  title: string;
  tags: string[];
  domain?: string;
  status?: string;
  confidence?: string;
  updatedAt?: string;
};

type ThreadPreview = {
  threadId: string;
  chatKey: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  title?: string;
  nextStep?: string;
  blockers?: string[];
  summaryPreview?: string;
};

type Candidate = {
  id: string;
  sourceCategory: 'episode' | 'knowledge';
  sourceId: string;
  targetCategory: 'knowledge' | 'identity';
  title: string;
  content: string;
  status?: string;
  applied?: boolean;
  appliedTargetId?: string;
  review?: {
    decision: 'approve' | 'reject' | 'defer' | 'merge';
    reviewer?: string;
    rationale?: string;
    reviewedAt?: string;
  };
};

export function MemoryPage() {
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeType, setActiveType] = useState<MemoryType>('identity');
  const [identityContent, setIdentityContent] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeSummary[]>([]);
  const [selectedKnowledge, setSelectedKnowledge] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateFilter, setCandidateFilter] = useState<'identity' | 'knowledge'>('identity');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  const showSuccess = (message: string) => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    setSuccess(message);
    successTimeoutRef.current = setTimeout(() => setSuccess(''), 2000);
  };

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

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
        .then(data => {
          setEpisodes(data.episodes || []);
          setThreads(data.threads || []);
        });
    } else if (activeType === 'candidates') {
      fetch(`/api/memory/candidates?targetCategory=${candidateFilter}`)
        .then(res => res.json())
        .then(data => setCandidates(data.candidates || []));
    }
  }, [activeType, candidateFilter]);

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
    showSuccess('身份记忆已保存');
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
    showSuccess('知识记忆已保存');
  };

  const updateKnowledgeStatus = async (id: string, status: string) => {
    await fetch('/api/memory/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    setKnowledgeList((items) => items.map(item => item.id === id ? { ...item, status } : item));
    showSuccess('知识状态已更新');
  };

  const updateThreadStatus = async (threadId: string, status: string, nextStep?: string) => {
    await fetch(`/api/memory/threads/${encodeURIComponent(threadId)}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, nextStep }),
    });
    setThreads((items) => items.map(item => item.threadId === threadId ? { ...item, status, nextStep } : item));
    showSuccess('线程状态已更新');
  };

  const reviewCandidate = async (id: string, decision: 'approve' | 'reject' | 'defer') => {
    const response = await fetch('/api/memory/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision }),
    });
    const data = await response.json();
    if (data.candidate) {
      setCandidates((items) => items.map(item => item.id === id ? data.candidate : item));
      showSuccess('Candidate 状态已更新');
    }
  };

  return (
    <div className="max-w-6xl space-y-4">
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-2 rounded-lg">
          {success}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
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
        <button
          onClick={() => setActiveType('candidates')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            activeType === 'candidates' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'
          }`}
        >
          <GitBranch className="w-4 h-4" />
          Candidates
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
            <div className="space-y-2">
              {knowledgeList.map((topic) => (
                <div
                  key={topic.id}
                  onClick={() => setSelectedKnowledge(topic.id)}
                  className={`px-2 py-2 rounded cursor-pointer text-sm ${
                    selectedKnowledge === topic.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'
                  }`}
                >
                  <div className="font-medium">{topic.title || topic.id}</div>
                  <div className="text-xs opacity-70 mb-2">{topic.id}.md</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-gray-900/60 px-2 py-0.5">{topic.status || 'active'}</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        updateKnowledgeStatus(topic.id, topic.status === 'archived' ? 'active' : 'archived');
                      }}
                      className="rounded bg-gray-900/60 px-2 py-0.5 hover:bg-gray-900"
                    >
                      {topic.status === 'archived' ? '恢复' : '归档'}
                    </button>
                  </div>
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
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h4 className="text-lg font-medium text-gray-200 mb-3">线程预览</h4>
            <div className="space-y-2">
              {threads.map(thread => (
                <div key={thread.threadId} className="bg-gray-900 rounded p-3 border border-gray-700">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <div className="text-sm text-gray-200 font-medium">{thread.title || thread.threadId}</div>
                      <div className="text-xs text-gray-400">{thread.chatKey}</div>
                    </div>
                    <span className="text-xs rounded bg-gray-800 px-2 py-1 text-gray-300">{thread.status}</span>
                  </div>
                  {thread.summaryPreview && <div className="text-sm text-gray-300 mb-2">{thread.summaryPreview}</div>}
                  {thread.nextStep && <div className="text-xs text-blue-300 mb-2">Next: {thread.nextStep}</div>}
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => updateThreadStatus(thread.threadId, 'dormant', thread.nextStep)} className="rounded bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700">休眠</button>
                    <button onClick={() => updateThreadStatus(thread.threadId, 'closed', thread.nextStep)} className="rounded bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700">关闭</button>
                    <button onClick={() => updateThreadStatus(thread.threadId, 'active', thread.nextStep)} className="rounded bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700">恢复</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
        </div>
      )}

      {activeType === 'candidates' && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCandidateFilter('identity')}
              className={`px-3 py-1 rounded text-sm ${candidateFilter === 'identity' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-300'}`}
            >
              Identity
            </button>
            <button
              onClick={() => setCandidateFilter('knowledge')}
              className={`px-3 py-1 rounded text-sm ${candidateFilter === 'knowledge' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-300'}`}
            >
              Knowledge
            </button>
          </div>
          <div className="space-y-3">
            {candidates.map(candidate => (
              <div key={candidate.id} className="bg-gray-900 rounded p-4 border border-gray-700">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-medium text-gray-200">{candidate.title}</div>
                    <div className="text-xs text-gray-400">{candidate.sourceCategory}/{candidate.sourceId} → {candidate.targetCategory}</div>
                  </div>
                  <span className="text-xs rounded bg-gray-800 px-2 py-1 text-gray-300">{candidate.status || 'proposed'}</span>
                </div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap mb-3">{candidate.content}</div>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => reviewCandidate(candidate.id, 'approve')} className="inline-flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-green-300 hover:bg-green-600/30"><CheckCircle2 className="w-3 h-3" />批准</button>
                  <button onClick={() => reviewCandidate(candidate.id, 'defer')} className="inline-flex items-center gap-1 rounded bg-yellow-600/20 px-2 py-1 text-yellow-300 hover:bg-yellow-600/30"><PauseCircle className="w-3 h-3" />延后</button>
                  <button onClick={() => reviewCandidate(candidate.id, 'reject')} className="inline-flex items-center gap-1 rounded bg-red-600/20 px-2 py-1 text-red-300 hover:bg-red-600/30"><Archive className="w-3 h-3" />拒绝</button>
                </div>
              </div>
            ))}
            {candidates.length === 0 && <div className="text-sm text-gray-400">暂无 candidates</div>}
          </div>
        </div>
      )}
    </div>
  );
}
