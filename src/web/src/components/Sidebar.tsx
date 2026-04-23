import { useState } from "react";
import {
  MessageSquare,
  BarChart3,
  Settings,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Sliders,
  Clock,
  Brain,
  Radio,
  Bell,
} from "lucide-react";
import type { Session, ConnectionStatus } from "../types";

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onSelectConfig: () => void;
  onSelectCron: () => void;
  onSelectStats?: () => void;
  onSelectMemory?: () => void;
  onSelectGateways?: () => void;
  onSelectProactive?: () => void;
  connectionStatus: ConnectionStatus;
  activeView: "chat" | "config" | "cron" | "stats" | "memory" | "gateways" | "proactive";
  className?: string;
}

type ModuleKey = "chat" | "control" | "settings";

interface ModuleItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Module {
  key: ModuleKey;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items?: ModuleItem[];
}

const MODULES: Module[] = [
  { key: "chat", title: "聊天", icon: MessageSquare },
  {
    key: "control",
    title: "控制",
    icon: BarChart3,
    items: [
      { key: "memory", label: "记忆体系", icon: Brain },
      { key: "stats", label: "使用统计", icon: BarChart3 },
      { key: "cron", label: "定时任务", icon: Clock },
    ],
  },
  {
    key: "settings",
    title: "设置",
    icon: Settings,
    items: [
      { key: "config", label: "模型", icon: Sliders },
      { key: "gateways", label: "网关", icon: Radio },
      { key: "proactive", label: "主动服务", icon: Bell },
    ],
  },
];

export function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onSelectConfig,
  onSelectCron,
  onSelectStats,
  onSelectMemory,
  onSelectGateways,
  onSelectProactive,
  connectionStatus,
  activeView,
  className,
}: SidebarProps) {
  const [expandedModules, setExpandedModules] = useState<Set<ModuleKey>>(
    new Set(["chat"]),
  );

  const toggleModule = (moduleKey: ModuleKey) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) {
        next.delete(moduleKey);
      } else {
        next.add(moduleKey);
      }
      return next;
    });
  };

  return (
    <div
      className={`w-64 bg-white border-r border-gray-200 flex flex-col ${className}`}
    >
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-bold">五</span>
          </div>
          <h1 className="text-base font-bold text-gray-900">Friday</h1>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          {connectionStatus === "connected" ? (
            <>
              <Wifi className="w-4 h-4 text-green-500" />
              <span className="text-green-600">已连接</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-red-500" />
              <span className="text-red-600">未连接</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {MODULES.map((module) => {
          const isExpanded = expandedModules.has(module.key);
          const ModuleIcon = module.icon;

          if (module.key === "chat") {
            return (
              <div
                key={module.key}
                className={`flex items-center gap-2 px-4 py-3 cursor-pointer transition-colors border-b border-gray-100 ${
                  activeView === "chat"
                    ? "bg-blue-50 text-blue-600"
                    : "hover:bg-gray-50 text-gray-700"
                }`}
                onClick={() => onSelectSession(currentSessionId)}
              >
                <ModuleIcon className="w-4 h-4" />
                <span className="text-sm font-medium">{module.title}</span>
              </div>
            );
          }

          return (
            <div key={module.key} className="border-b border-gray-100">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleModule(module.key)}
              >
                <div className="flex items-center gap-2">
                  <ModuleIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {module.title}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </div>

              {isExpanded && module.items && (
                <div className="bg-gray-50">
                  {module.items.map((item) => {
                    const ItemIcon = item.icon;
                    const isActive = activeView === item.key;
                    return (
                      <div
                        key={item.key}
                        className={`flex items-center gap-2 px-6 py-2 cursor-pointer ${
                          isActive
                            ? "bg-blue-50 text-blue-600"
                            : "hover:bg-gray-100 text-gray-700"
                        }`}
                        onClick={() => {
                          if (item.key === "config") onSelectConfig();
                          if (item.key === "cron") onSelectCron();
                          if (item.key === "stats" && onSelectStats)
                            onSelectStats();
                          if (item.key === "memory" && onSelectMemory)
                            onSelectMemory();
                          if (item.key === "gateways" && onSelectGateways)
                            onSelectGateways();
                          if (item.key === "proactive" && onSelectProactive)
                            onSelectProactive();
                        }}
                      >
                        <ItemIcon
                          className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-gray-500"}`}
                        />
                        <span className="text-sm">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
