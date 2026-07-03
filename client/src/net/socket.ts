import { useEffect, useRef, useState } from "react";
import {
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@shared/index";

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/**
 * One auto-reconnecting socket. `join` is sent on every (re)connect so a
 * refreshed TV or phone slides straight back into its room.
 */
export function useSocket(
  join: ClientMessage | null,
  onMessage: (msg: ServerMessage) => void,
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const joinRef = useRef(join);
  joinRef.current = join;

  const joinKey = join ? JSON.stringify(join) : null;

  useEffect(() => {
    if (!joinKey && join !== null) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        if (joinRef.current) ws.send(encode(joinRef.current));
      };
      ws.onmessage = (ev) => {
        try {
          onMessageRef.current(JSON.parse(ev.data as string) as ServerMessage);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [joinKey]);

  const send = (msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(encode(msg));
  };

  return { connected, send };
}
