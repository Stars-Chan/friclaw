import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, X } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
      showDetails: false
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 更新状态以包含错误信息
    this.setState({ errorInfo });

    // 记录到控制台
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    console.error('Component stack:', errorInfo.componentStack);

    // 调用自定义错误处理回调
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 在开发环境下，可以将错误发送到错误追踪服务
    if (import.meta.env.PROD && typeof window !== 'undefined') {
      // 这里可以集成 Sentry 或其他错误追踪服务
      // Sentry.captureException(error, { contexts: { react: errorInfo } });
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleCopyError = () => {
    const errorText = [
      `Error: ${this.state.error?.toString()}`,
      ``,
      `Component Stack:`,
      this.state.errorInfo?.componentStack || 'N/A'
    ].join('\n');

    navigator.clipboard.writeText(errorText).then(() => {
      // 可以添加一个 toast 提示
      console.log('Error copied to clipboard');
    });
  };

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      // 使用自定义 fallback 或默认错误 UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = import.meta.env.DEV;
      const errorName = this.state.error?.name || 'Error';
      const errorMessage = this.state.error?.message || '发生未知错误';

      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 p-4">
          <div className="max-w-2xl w-full bg-gray-800 rounded-lg shadow-xl border border-gray-700">
            {/* 错误图标和标题 */}
            <div className="flex items-start gap-4 p-6 border-b border-gray-700">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-100 mb-2">
                  应用程序错误
                </h2>
                <p className="text-gray-400 text-sm">
                  抱歉，应用程序遇到了意外错误。请尝试刷新页面或联系支持。
                </p>
              </div>
              <button
                onClick={() => this.setState({ hasError: false })}
                className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 错误详情 */}
            <div className="p-6 space-y-4">
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-1 bg-red-500/10 text-red-400 text-xs font-mono rounded">
                    {errorName}
                  </span>
                </div>
                <p className="text-gray-300 font-mono text-sm break-all">
                  {errorMessage}
                </p>
              </div>

              {/* 开发环境下显示详细信息 */}
              {isDev && this.state.errorInfo && (
                <div>
                  <button
                    onClick={this.toggleDetails}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-3"
                  >
                    {this.state.showDetails ? (
                      <span>隐藏详细信息</span>
                    ) : (
                      <span>显示详细信息</span>
                    )}
                  </button>

                  {this.state.showDetails && (
                    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-mono text-gray-500">Component Stack</span>
                        <button
                          onClick={this.handleCopyError}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          复制
                        </button>
                      </div>
                      <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap overflow-x-auto">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3 p-6 border-t border-gray-700">
              <button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
