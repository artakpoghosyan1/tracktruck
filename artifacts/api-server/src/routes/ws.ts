import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { verifyToken } from "../lib/jwt";

// Public channel: keyed by share token
const clients = new Map<string, Set<WebSocket>>();

// Admin channel: keyed by routeId
const adminClients = new Map<number, Set<WebSocket>>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);

    // Public tracking channel: /api/public/ws/track/:token
    const publicMatch = url.pathname.match(/^\/api\/public\/ws\/track\/([a-zA-Z0-9_-]+)$/);
    if (publicMatch) {
      const token = publicMatch[1];
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        handlePublicConnection(ws, token);
      });
      return;
    }

    // Admin live channel: /api/admin/ws/routes/:routeId?token=<jwt>
    const adminMatch = url.pathname.match(/^\/api\/admin\/ws\/routes\/(\d+)$/);
    if (adminMatch) {
      const routeId = parseInt(adminMatch[1]);
      const jwtToken = url.searchParams.get("token");
      if (!jwtToken) {
        socket.destroy();
        return;
      }
      try {
        const payload = verifyToken(jwtToken);
        if (payload.type !== "access") {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        handleAdminConnection(ws, routeId);
      });
      return;
    }

    socket.destroy();
  });

  return { wss, clients };
}

function handlePublicConnection(ws: WebSocket, token: string) {
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

function handleAdminConnection(ws: WebSocket, routeId: number) {
  if (!adminClients.has(routeId)) {
    adminClients.set(routeId, new Set());
  }
  adminClients.get(routeId)!.add(ws);

  ws.on("close", () => {
    const routeClients = adminClients.get(routeId);
    if (routeClients) {
      routeClients.delete(ws);
      if (routeClients.size === 0) {
        adminClients.delete(routeId);
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

export function broadcastToRoute(routeId: number, data: unknown) {
  const routeClients = adminClients.get(routeId);
  if (!routeClients) return;

  const message = JSON.stringify(data);
  for (const ws of routeClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}
