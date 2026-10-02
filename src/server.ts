import { randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createMcpServer } from "./mcp.js";
import { buildBridgeEvent } from "./bridge/events.js";
export { buildBridgeEvent } from "./bridge/events.js";
import { MCP_PATHS } from "./profiles.js";
import { listenerWakeHub } from "./listenerWake.js";
import { PlaybackStateStore } from "./netease/playbackState.js";
import { NeteaseClient } from "./netease/client.js";
import { QrLogin } from "./netease/qrLogin.js";
import { loginPage } from "./netease/loginPage.js";
import { createTogetherWorker } from "./netease/togetherWorker.js";
import { InMemoryEventQueue } from "./queue.js";
import { OwnerAuth } from "./ownerAuth.js";

const PORT = Number(process.env.PORT ?? 8787);
const INGEST_TOKEN = process.env.BRIDGE_INGEST_TOKEN ?? "";
const SITE_RELAY_TOKEN = process.env.BRIDGE_SITE_RELAY_TOKEN ?? "";
const UNIX_SOCKET = process.env.BRIDGE_UNIX_SOCKET?.trim() ?? "";
const queue = new InMemoryEventQueue();
const playbackState = new PlaybackStateStore();
const ownerAuth = new OwnerAuth();
const qrLogin = new QrLogin();
const TEST_BYPASS = process.env.NODE_ENV === "test"
  && process.env.COVE_TEST_INSECURE_ALLOW === "1"
  && !process.env.BRIDGE_OWNER_SECRET;

function enqueueTogetherEvent(
  source: string,
  text: string,
  additionalModelContext?: string,
): boolean {
  const id = randomUUID();
  const created = queue.enqueue(buildBridgeEvent(
    id,
    source,
    text,
    new Date().toISOString(),
    additionalModelContext,
  ));
  if (created) listenerWakeHub.wake(source);
  return created;
}

let togetherWorker = createTogetherWorker(enqueueTogetherEvent, playbackState);

const eventInput = z.object({
  eventId: z.string().trim().min(1).max(200).optional(),
  source: z.string().trim().min(1).max(80).default("test"),
  text: z.string().trim().min(1).max(4000),
});

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function authorized(req: IncomingMessage): boolean {
  return (TEST_BYPASS && !INGEST_TOKEN)
    || (Boolean(INGEST_TOKEN) && req.headers.authorization === `Bearer ${INGEST_TOKEN}`)
    || ownerAuth.hasMcpToken(req);
}

function siteRelayAuthorized(req: IncomingMessage): boolean {
  if (!SITE_RELAY_TOKEN) return false;
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(SITE_RELAY_TOKEN, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createHttpServer() {
  return createServer(async (req, res) => {
    if (!req.url || !req.method) {
      res.writeHead(400).end("Bad Request");
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      writeJson(res, 200, {
        ok: true,
        service: "cove-bridge",
        version: "0.1.0",
      });
      return;
    }

    try {
      if (await ownerAuth.handle(req, res, url, () => readJson(req))) return;
    } catch {
      writeJson(res, 400, { error: "invalid_auth_request" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/login") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      res.end(loginPage);
      return;
    }

    if (req.method === "GET" && url.pathname === "/login/status") {
      if (!ownerAuth.hasAdminSession(req)) {
        writeJson(res, 401, { error: "unauthorized" });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      writeJson(res, 200, { accountReady: togetherWorker.getStatus().enabled });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/login/qr" || url.pathname === "/login/check")) {
      if (!ownerAuth.hasAdminSession(req) || (req.headers.origin && req.headers.origin !== process.env.BRIDGE_PUBLIC_ORIGIN)) {
        writeJson(res, 401, { error: "unauthorized" });
        return;
      }
      if (togetherWorker.getStatus().enabled) {
        writeJson(res, 409, { error: "account_already_active" });
        return;
      }
      try {
        if (url.pathname === "/login/qr") {
          writeJson(res, 200, { image: await qrLogin.create(), expiresInSeconds: 180 });
        } else {
          const result = await qrLogin.check();
          if (result.status === "confirmed" && result.cookie) {
            // Validate the session before keeping it. Never return or log the cookie.
            await new NeteaseClient(result.cookie).getAccountProfile();
            process.env.NETEASE_COOKIE = result.cookie;
            process.env.TOGETHER_ENABLED = "true";
            togetherWorker = createTogetherWorker(enqueueTogetherEvent, playbackState);
            togetherWorker.start();
          }
          writeJson(res, 200, { status: result.status });
        }
      } catch {
        writeJson(res, 502, { error: "netease_login_unavailable" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/listener/events") {
      const authorization = req.headers.authorization ?? "";
      const bearerToken = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : "";
      const token = bearerToken || url.searchParams.get("session")?.trim() || "";
      const session = token ? listenerWakeHub.consumeSession(token) : null;
      if (!session) {
        writeJson(res, 401, { error: "invalid_or_expired_listener_session" });
        return;
      }
      listenerWakeHub.subscribe(res, session.expiresAtMs);
      return;
    }

    if (req.method === "POST" && url.pathname === "/events") {
      if (!authorized(req)) {
        writeJson(res, 401, { error: "unauthorized" });
        return;
      }
      try {
        const parsed = eventInput.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: parsed.error.flatten() });
          return;
        }
        const createdAt = new Date().toISOString();
        const id = parsed.data.eventId ?? randomUUID();
        const event = buildBridgeEvent(id, parsed.data.source, parsed.data.text, createdAt);
        const created = queue.enqueue(event);
        if (created) listenerWakeHub.wake(parsed.data.source);
        writeJson(res, created ? 201 : 200, { ok: true, created, eventId: id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid_request";
        writeJson(res, message === "request_too_large" ? 413 : 400, { error: message });
      }
      return;
    }

    const mcpMethods = new Set(["POST", "GET", "DELETE"]);
    const mcpProfile = MCP_PATHS.get(url.pathname);
    if (mcpProfile && mcpMethods.has(req.method)) {
      if (!TEST_BYPASS && !ownerAuth.hasMcpToken(req) && !siteRelayAuthorized(req)) {
        ownerAuth.challenge(res);
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      const server = createMcpServer(queue, playbackState, togetherWorker, mcpProfile);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("MCP request failed", error);
        if (!res.headersSent) writeJson(res, 500, { error: "internal_server_error" });
      }
      return;
    }

    res.writeHead(404).end("Not Found");
  });
}

if (process.env.NODE_ENV !== "test") {
  createHttpServer().listen(PORT, "0.0.0.0", () => {
    console.log("Cove Resonance listening on http://0.0.0.0:" + PORT + " (MCP: /mcp, /mcp/music)");
    togetherWorker.start();
  });

  if (UNIX_SOCKET) {
    if (existsSync(UNIX_SOCKET)) unlinkSync(UNIX_SOCKET);
    createHttpServer().listen(UNIX_SOCKET, () => {
      chmodSync(UNIX_SOCKET, 0o666);
      console.log("Cove Resonance listening on unix://" + UNIX_SOCKET + " (MCP: /mcp, /mcp/music)");
    });
  }
}
