import { useState } from 'react';
import { Menu, AlertCircle } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ConfigPage } from './components/ConfigPage';
import { CronPage } from './components/CronPage';
import { StatsPage } from './components/StatsPage';
import { MemoryPage } from './components/MemoryPage';
import { GatewaysPage } from './components/GatewaysPage';
import { ProactivePage } from './components/ProactivePage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ComponentErrorBoundary } from './components/ComponentErrorBoundary';
import { useWebSocket } from './hooks/useWebSocket';
import { useSessions } from './hooks/useSessions';
import './styles/globals.css';

const APP_VIEWS = ['chat', 'config', 'cron', 'stats', 'memory', 'gateways', 'proactive'] as const;
type AppView = typeof APP_VIEWS[number];

function App() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(() => {
    const saved = localStorage.getItem('activeView');
    return (APP_VIEWS as readonly string[]).includes(saved || '') ? saved as AppView : 'chat';
  });
  const { sessions, currentSessionId, selectSession, updateSession } = useSessions();
  const { messages, isConnected, sendMessage, connectionStatus, error } = useWebSocket(
    currentSessionId,
    (newSessionId) => selectSession(newSessionId)
  );

  const handleSelectSession = (sessionId: string) => {
    setIsMobileSidebarOpen(false);
    setActiveView('chat');
    localStorage.setItem('activeView', 'chat');
    selectSession(sessionId);
  };

  const selectView = (view: Exclude<AppView, 'chat'>) => {
    setIsMobileSidebarOpen(false);
    setActiveView(view);
    localStorage.setItem('activeView', view);
  };

  const handleSelectConfig = () => selectView('config');
  const handleSelectCron = () => selectView('cron');
  const handleSelectStats = () => selectView('stats');
  const handleSelectMemory = () => selectView('memory');
  const handleSelectGateways = () => selectView('gateways');
  const handleSelectProactive = () => selectView('proactive');

  const handleSendMessage = (text: string) => {
    sendMessage(text);
    if (messages.length === 0) {
      updateSession(currentSessionId, { messageCount: 1, updatedAt: Date.now() });
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-900 text-gray-100">
        {error && (
          <div className="fixed top-4 right-4 z-50 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-md">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/40 transition-opacity ${
          isMobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileSidebarOpen(false)}
      />

      <ComponentErrorBoundary componentName="Sidebar">
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onSelectConfig={handleSelectConfig}
          onSelectCron={handleSelectCron}
          onSelectStats={handleSelectStats}
          onSelectMemory={handleSelectMemory}
          onSelectGateways={handleSelectGateways}
          onSelectProactive={handleSelectProactive}
          connectionStatus={connectionStatus}
          activeView={activeView}
          className={`fixed md:static top-0 left-0 h-full z-50 transform transition-transform md:translate-x-0 ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        />
      </ComponentErrorBoundary>

      {activeView === 'config' ? (
        <div className="flex-1 flex flex-col bg-gray-900">
          <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-100">配置</h2>
          </header>
          <div className="flex-1 overflow-y-auto p-6">
            <ComponentErrorBoundary componentName="ConfigPage">
              <ConfigPage />
            </ComponentErrorBoundary>
          </div>
        </div>
      ) : activeView === 'cron' ? (
        <div className="flex-1 flex flex-col bg-gray-900">
          <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
          </header>
          <ComponentErrorBoundary componentName="CronPage">
            <CronPage />
          </ComponentErrorBoundary>
        </div>
      ) : activeView === 'stats' ? (
        <div className="flex-1 flex flex-col bg-gray-900">
          <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-100">统计</h2>
          </header>
          <div className="flex-1 p-6">
            <ComponentErrorBoundary componentName="StatsPage">
              <StatsPage />
            </ComponentErrorBoundary>
          </div>
        </div>
      ) : activeView === 'memory' ? (
        <div className="flex-1 flex flex-col bg-gray-900">
          <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-100">记忆体系</h2>
          </header>
          <div className="flex-1 p-6 overflow-auto">
            <ComponentErrorBoundary componentName="MemoryPage">
              <MemoryPage />
            </ComponentErrorBoundary>
          </div>
        </div>
      ) : activeView === 'gateways' ? (
        <div className="flex-1 flex flex-col bg-gray-900">
          <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-100">网关配置</h2>
          </header>
          <div className="flex-1 overflow-y-auto p-6">
            <ComponentErrorBoundary componentName="GatewaysPage">
              <GatewaysPage />
            </ComponentErrorBoundary>
          </div>
        </div>
      ) : activeView === 'proactive' ? (
        <div className="flex-1 flex flex-col bg-gray-900">
          <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-100">主动服务</h2>
          </header>
          <div className="flex-1 overflow-y-auto p-6">
            <ComponentErrorBoundary componentName="ProactivePage">
              <ProactivePage />
            </ComponentErrorBoundary>
          </div>
        </div>
      ) : (
        <ComponentErrorBoundary componentName="ChatArea">
          <ChatArea
            sessionId={currentSessionId}
            messages={messages}
            onSendMessage={handleSendMessage}
            isConnected={isConnected}
            onOpenMenu={() => setIsMobileSidebarOpen(true)}
          />
        </ComponentErrorBoundary>
      )}
    </div>
    </ErrorBoundary>
  );
}

export default App;
