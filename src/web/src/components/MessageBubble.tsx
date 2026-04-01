import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../types';
import { User, Bot, ChevronDown, ChevronRight } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-blue-600' : 'bg-gray-700'
      }`}>
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>

      <div className={`flex-1 max-w-3xl ${isUser ? 'text-right' : ''}`}>
        <div className="space-y-3">
          {!isUser && message.thinkingContent && (
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className="w-full px-3 py-2 bg-gray-800/50 hover:bg-gray-800/70 flex items-center gap-2 text-sm text-gray-400 transition-colors"
              >
                {isThinkingExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <span className="font-medium">💭 思考过程</span>
              </button>
              {isThinkingExpanded && (
                <div className="px-4 py-3 bg-gray-800/30 text-gray-400 text-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    className="prose prose-invert prose-sm max-w-none"
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const inline = !props.node || props.node.tagName !== 'pre';
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={vscDarkPlus as any}
                            language={match[1]}
                            PreTag="div"
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {message.thinkingContent}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}

          <div className={`inline-block px-4 py-3 rounded-lg overflow-x-auto ${
            isUser
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-100'
          }`}>
            {isUser ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                className="prose prose-invert prose-p:my-0 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 max-w-none"
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const inline = !props.node || props.node.tagName !== 'pre';
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={vscDarkPlus as any}
                        language={match[1]}
                        PreTag="div"
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className="bg-white/10 px-1 py-0.5 rounded text-sm" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                className="prose prose-invert max-w-none"
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const inline = !props.node || props.node.tagName !== 'pre';
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={vscDarkPlus as any}
                        language={match[1]}
                        PreTag="div"
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content || '*Thinking...*'}
              </ReactMarkdown>
            )}
          </div>
        </div>
        {!isUser && message.stats && (
          <div className="mt-2 text-xs text-gray-400">
            {[
              message.stats.elapsedMs && `${(message.stats.elapsedMs / 1000).toFixed(1)}s`,
              message.stats.inputTokens && `${message.stats.inputTokens} in`,
              message.stats.outputTokens && `${message.stats.outputTokens} out`,
              message.stats.costCny && `¥${message.stats.costCny.toFixed(4)}`,
              message.stats.model,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
