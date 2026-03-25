import { Menu } from 'lucide-react';
import type { Message } from '../types';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';

interface ChatAreaProps {
  sessionId: string;
  messages: Message[];
  onSendMessage: (text: string) => void;
  isConnected: boolean;
  onOpenMenu: () => void;
}

export function ChatArea({ messages, onSendMessage, isConnected, onOpenMenu }: ChatAreaProps) {
  return (
    <div className="flex-1 flex flex-col bg-gray-900">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
        <button
          type="button"
          className="md:hidden p-2 rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
          onClick={onOpenMenu}
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-gray-100">Chat</h2>
      </header>

      <MessageList messages={messages} />
      <InputBox onSendMessage={onSendMessage} disabled={!isConnected} />
    </div>
  );
}
