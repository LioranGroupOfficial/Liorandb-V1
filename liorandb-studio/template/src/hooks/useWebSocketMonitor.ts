import { useState, useEffect, useRef } from 'react';

interface WebSocketMonitorState {
  activeConnections: number;
  messagesPerSecond: number;
  avgLatency: number;
}

export function useWebSocketMonitor(): WebSocketMonitorState {
  const [state, setState] = useState<WebSocketMonitorState>({
    activeConnections: 0,
    messagesPerSecond: 0,
    avgLatency: 0,
  });

  const messageCountRef = useRef(0);
  const latenciesRef = useRef<number[]>([]);
  const lastCountResetRef = useRef(Date.now());

  useEffect(() => {
    // Simulate WebSocket activity
    const interval = setInterval(() => {
      const now = Date.now();
      const timeDiff = now - lastCountResetRef.current;

      if (timeDiff >= 1000) {
        const mps = messageCountRef.current / (timeDiff / 1000);
        const avgLat =
          latenciesRef.current.length > 0
            ? latenciesRef.current.reduce((a, b) => a + b, 0) / latenciesRef.current.length
            : 0;

        setState({
          activeConnections: Math.max(0, Math.random() > 0.5 ? 1 : 0),
          messagesPerSecond: mps,
          avgLatency: avgLat,
        });

        messageCountRef.current = 0;
        latenciesRef.current = [];
        lastCountResetRef.current = now;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return state;
}
