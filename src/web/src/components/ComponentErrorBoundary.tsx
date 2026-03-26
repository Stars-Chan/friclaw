import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  componentName: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 组件级别的错误边界
 * 用于保护单个组件，避免整个应用崩溃
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`${this.props.componentName} error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center p-8 bg-gray-800/50 rounded-lg border border-gray-700 m-4">
          <AlertTriangle className="w-8 h-8 text-yellow-500 mb-3" />
          <h3 className="text-sm font-medium text-gray-200 mb-2">
            {this.props.componentName} 组件加载失败
          </h3>
          <p className="text-xs text-gray-400 mb-4">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
