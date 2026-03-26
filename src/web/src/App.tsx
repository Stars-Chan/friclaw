import { useState } from 'react';
import { Menu, AlertCircle } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ConfigPage } from './components/ConfigPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ComponentErrorBoundary } from './components/ComponentErrorBoundary';
import { useWebSocket } from './hooks/useWebSocket';
import { useSessions } from './hooks/useSessions';
import './styles/globals.css';

function App() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'config'>('chat');
  const { sessions, currentSessionId, selectSession, updateSession } = useSessions();
  const { messages, isConnected, sendMessage, connectionStatus, error } = useWebSocket(
    currentSessionId,
    (newSessionId) => selectSession(newSessionId)
  );

  const handleSelectSession = (sessionId: string) => {
    setIsMobileSidebarOpen(false);
    setActiveView('chat');
    selectSession(sessionId);
  };

  const handleSelectConfig = () => {
    setIsMobileSidebarOpen(false);
    setActiveView('config');
  };

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
          connectionStatus={connectionStatus}
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
          <div className="flex-1 p-6">
            <ComponentErrorBoundary componentName="ConfigPage">
              <ConfigPage />
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
