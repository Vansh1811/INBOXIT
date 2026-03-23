import { useEffect } from "react";
import { Socket } from "socket.io-client";

export function useSocketEvent(
  socket: Socket | null,
  event: string,
  handler: (...args: unknown[]) => void
) {
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}
