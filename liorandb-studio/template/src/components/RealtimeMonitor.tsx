'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Zap, TrendingUp } from 'lucide-react';
import { useThemeStore } from '@/store/theme';

interface RealtimeMonitorProps {
  isConnected: boolean;
}

export function RealtimeMonitor({ isConnected }: RealtimeMonitorProps) {
  const { theme } = useThemeStore();
  const { activeConnections, messagesPerSecond, avgLatency } = useWebSocketMonitor();
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isDark = theme === 'dark';

  return (
    <div className={`absolute bottom-4 right-4 p-4 rounded-lg border backdrop-blur transition ${
      isDark 
        ? 'bg-slate-900/80 border-slate-700' 
        : 'bg-white border-slate-200 shadow-lg'
    }`}>
      <div className="space-y-2 text-sm">
        {/* Status */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>

        {/* Metrics */}
        <div className="space-y-1 pt-2 border-t" style={{ borderColor: isDark ? '#475569' : '#e2e8f0' }}>
          <div className="flex items-center gap-2 text-xs">
            <Activity size={14} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
            <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              Connections: {activeConnections}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Zap size={14} className={isDark ? 'text-yellow-400' : 'text-yellow-600'} />
            <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              {messagesPerSecond.toFixed(1)} msg/s
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <TrendingUp size={14} className={isDark ? 'text-green-400' : 'text-green-600'} />
            <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              {avgLatency.toFixed(0)}ms latency
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useWebSocketMonitor(): {
  activeConnections: number;
  messagesPerSecond: number;
  avgLatency: number;
} {
  const [activeConnections, setActiveConnections] = useState(0);
  const [messagesPerSecond, setMessagesPerSecond] = useState(0);
  const [avgLatency, setAvgLatency] = useState(0);

  useEffect(() => {
    let mounted = true;

    const updateMetrics = () => {
      // Simple simulated metrics — replace with real WebSocket logic as needed
      const connections = Math.max(0, Math.round(Math.random() * 5));
      const mps = +(Math.random() * 10).toFixed(1);
      const latency = Math.round(10 + Math.random() * 200);

      if (!mounted) return;
      setActiveConnections(connections);
      setMessagesPerSecond(mps);
      setAvgLatency(latency);
    };

    updateMetrics();
    const id = setInterval(updateMetrics, 1000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return { activeConnections, messagesPerSecond, avgLatency };
}
