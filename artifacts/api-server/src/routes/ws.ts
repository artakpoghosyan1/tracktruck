import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";

const clients = new Map<string, Set<WebSocket>>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/api\/public\/ws\/track\/([a-zA-Z0-9_-]+)$/);

    if (!match) {
      socket.destroy();
      return;
    }

    const token = match[1];

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      handleConnection(ws, token);
    });
  });

  return { wss, clients };
}

function handleConnection(ws: WebSocket, token: string) {
  if (!clients.has(token)) {
    clients.set(token, new Set());
  }
  clients.get(token)!.add(ws);

  ws.on("close", () => {
    const tokenClients = clients.get(token);
    if (tokenClients) {
      tokenClients.delete(ws);
      if (tokenClients.size === 0) {
        clients.delete(token);
      }
    }
  });
}

export function broadcastToToken(token: string, data: unknown) {
  const tokenClients = clients.get(token);
  if (!tokenClients) return;

  const message = JSON.stringify(data);
  for (const ws of tokenClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}
