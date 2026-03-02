import type { WsMessage } from './types.ts';
import { getToken } from './api.ts';

const WS_URL: string = (import.meta.env.VITE_LUMI_SERVER_URL || 'http://localhost:8080').replace('http', 'ws');

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket(onMessage: (msg: WsMessage) => void): WebSocket {
  const t = getToken();
  ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(t)}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    ws!.send(JSON.stringify({ type: 'subscribe' }));
  };

  ws.onmessage = (event: MessageEvent) => {
    const msg: WsMessage = JSON.parse(event.data);
    onMessage(msg);
  };

  ws.onerror = (error: Event) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    reconnectTimer = setTimeout(() => connectWebSocket(onMessage), 3000);
  };

  return ws;
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null; // prevent auto-reconnect
    ws.close();
    ws = null;
  }
}
