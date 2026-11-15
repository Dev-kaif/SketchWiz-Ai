"use client";

import { useEffect, useState } from "react";
import { WS_URL } from "../Config";

const useSocket = () => {
  const [socket, setSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let current: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt++, 6));
      retryTimer = setTimeout(connect, delay);
    };
    const connect = () => {
      if (stopped) return;
      const token = localStorage.getItem("authorization") || "";
      let next: WebSocket;
      try {
        if (!WS_URL) throw new Error("WebSocket URL is not configured");
        next = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      } catch {
        setSocket(null);
        scheduleReconnect();
        return;
      }
      current = next;
      connectTimer = setTimeout(() => {
        if (next.readyState === WebSocket.CONNECTING) next.close();
      }, 10_000);
      next.addEventListener("open", () => {
        if (stopped || current !== next) return next.close();
        if (connectTimer) clearTimeout(connectTimer);
        stableTimer = setTimeout(() => {
          attempt = 0;
        }, 10_000);
        setSocket(next);
      });
      next.addEventListener("close", () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (stableTimer) clearTimeout(stableTimer);
        if (current === next) {
          current = null;
          setSocket(null);
        }
        scheduleReconnect();
      });
      next.addEventListener("error", () => next.close());
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (stableTimer) clearTimeout(stableTimer);
      if (connectTimer) clearTimeout(connectTimer);
      current?.close(1000, "Canvas unmounted");
    };
  }, []);

  return socket;
};

export default useSocket;
