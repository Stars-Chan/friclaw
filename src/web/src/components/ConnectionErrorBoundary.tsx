import React, { Component, ReactNode } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  isConnected: boolean;
  isRetrying: boolean;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
}

/**
 * 连接错误边界
 * 专门处理 WebSocket 连接失败的情况
 */
export class ConnectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Connection error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 p-8">
          <WifiOff className="w-16 h-16 text-gray-700 mb-4" />
          <h2 className="text-xl font-semibold text-gray-200 mb-2">连接失败</h2>
          <p className="text-gray-400 text-sm mb-6">
            无法连接到服务器，请检查网络连接后重试
          </p>
          {this.props.onRetry && (
            <button
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onRetry?.();
              }}
              disabled={this.props.isRetrying}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${this.props.isRetrying ? 'animate-spin' : ''}`} />
              {this.props.isRetrying ? '重连中...' : '重新连接'}
            </button>
          )}
        </div>
      );
    }

    if (!this.props.isConnected && !this.props.isRetrying) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 p-8">
          <WifiOff className="w-16 h-16 text-gray-700 mb-4" />
          <h2 className="text-xl font-semibold text-gray-200 mb-2">未连接</h2>
          <p className="text-gray-400 text-sm mb-6">
            正在尝试连接到服务器...
          </p>
          {this.props.onRetry && (
            <button
              onClick={this.props.onRetry}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              立即连接
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
