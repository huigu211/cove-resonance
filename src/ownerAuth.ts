import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type Grant = {
  clientId: string; redirectUri: string; challenge: string; resource: string; scope: string; state: string;
};
type PendingCode = Grant & { expiresAt: number };

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const clean = (value: string) => value.replace(/[&"'<>]/g, (c) => ({
  "&": "&amp;", '"': "&quot;", "'": "&#39;", "<": "&lt;", ">": "&gt;",
})[c] ?? c);
const send = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

/** One owner per deployment. OWNER_SECRET is entered in Render, never in source or MCP tools. */
export class OwnerAuth {
  private readonly origin = (process.env.BRIDGE_PUBLIC_ORIGIN ?? "").trim().replace(/\/$/, "");
  private readonly secret = process.env.BRIDGE_OWNER_SECRET ?? "";
  private readonly codes = new Map<string, PendingCode>();
  private attempts: number[] = [];

  get ready(): boolean {
    return /^https:\/\/[^/]+$/.test(this.origin) && this.secret.length >= 32;
  }

  private mac(value: string): string {
    return encode(createHmac("sha256", this.secret).update(value).digest());
  }

  private token(kind: "admin" | "access" | "refresh", ttl: number, clientId?: string): string {
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encode(JSON.stringify({ typ: kind, sub: "owner", iss: this.origin,
      aud: this.origin, scope: "music", clientId,
      exp: Math.floor(Date.now() / 1000) + ttl }));
    return `${header}.${payload}.${this.mac(`${header}.${payload}`)}`;
  }

  private valid(token: string, kind: "admin" | "access" | "refresh", clientId?: string): boolean {
    if (!this.ready) return false;
    const [head, body, signature, extra] = token.split(".");
    if (!head || !body || !signature || extra || head.length > 100 || body.length > 2048) return false;
    const expected = Buffer.from(this.mac(`${head}.${body}`));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    try {
      const h = JSON.parse(Buffer.from(head, "base64url").toString()) as { alg?: string };
      const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
      return h.alg === "HS256" && p.typ === kind && p.sub === "owner" && p.iss === this.origin
        && p.aud === this.origin && p.scope === "music"
        && (clientId === undefined || p.clientId === clientId)
        && typeof p.exp === "number" && Number.isInteger(p.exp) && p.exp > Date.now() / 1000;
    } catch { return false; }
  }

  private password(candidate: string): boolean {
    if (!this.ready || candidate.length > 1024) return false;
    const a = createHash("sha256").update(candidate).digest();
    const b = createHash("sha256").update(this.secret).digest();
    return timingSafeEqual(a, b);
  }

  private attempt(): boolean {
    this.attempts = this.attempts.filter((time) => Date.now() - time < 60_000);
    if (this.attempts.length >= 5) return false;
    this.attempts.push(Date.now());
    return true;
  }

  private allowedRedirect(uri: string): boolean {
    return /^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/.test(uri);
  }

  private clientRedirect(clientId: string): string | null {
    const [prefix, redirect, signature, extra] = clientId.split(".");
    if (prefix !== "cove" || !redirect || !signature || extra || redirect.length > 1024) return null;
    const expected = Buffer.from(this.mac(`client.${redirect}`));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const uri = Buffer.from(redirect, "base64url").toString();
      return this.allowedRedirect(uri) ? uri : null;
    } catch { return null; }
  }

  private grant(params: URLSearchParams): Grant | null {
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const challenge = params.get("code_challenge") ?? "";
    const resource = params.get("resource") ?? "";
    const scope = params.get("scope") ?? "music";
    const state = params.get("state") ?? "";
    if (this.clientRedirect(clientId) !== redirectUri || !this.allowedRedirect(redirectUri)
      || params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256"
      || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || resource !== this.origin
      || scope !== "music" || state.length > 1024) return null;
    return { clientId, redirectUri, challenge, resource, scope, state };
  }

  hasAdminSession(req: IncomingMessage): boolean {
    const match = /(?:^|;\s*)cove_admin=([^;]+)/.exec(req.headers.cookie ?? "");
    return !!match && this.valid(match[1], "admin");
  }

  hasMcpToken(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") && this.valid(header.slice(7), "access");
  }

  challenge(res: ServerResponse): void {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource"`);
    send(res, 401, { error: "unauthorized" });
  }

  private async form(req: IncomingMessage): Promise<URLSearchParams> {
    if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
      throw new Error("invalid_content_type");
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 16_384) throw new Error("request_too_large");
    }
    return new URLSearchParams(body);
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL, readJson: () => Promise<unknown>): Promise<boolean> {
    const path = url.pathname;
    if (req.method === "GET" && path === "/login/session") {
      send(res, 200, { unlocked: this.hasAdminSession(req) });
      return true;
    }
    if (req.method === "GET" && (path === "/.well-known/oauth-protected-resource"
      || path === "/.well-known/oauth-protected-resource/mcp/music")) {
      send(res, 200, { resource: this.origin, authorization_servers: [this.origin], scopes_supported: ["music"] });
      return true;
    }
    if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
      send(res, 200, { issuer: this.origin, authorization_endpoint: `${this.origin}/oauth/authorize`,
        registration_endpoint: `${this.origin}/oauth/register`, token_endpoint: `${this.origin}/oauth/token`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
        scopes_supported: ["music"] });
      return true;
    }
    if (req.method === "POST" && path === "/oauth/register") {
      if (!this.ready) { send(res, 503, { error: "owner_not_configured" }); return true; }
      const body = await readJson() as { redirect_uris?: unknown };
      const redirects = body.redirect_uris;
      if (!Array.isArray(redirects) || redirects.length !== 1 || typeof redirects[0] !== "string"
        || !this.allowedRedirect(redirects[0])) {
        send(res, 400, { error: "invalid_redirect_uri" }); return true;
      }
      const redirect = encode(redirects[0]);
      send(res, 201, { client_id: `cove.${redirect}.${this.mac(`client.${redirect}`)}`,
        redirect_uris: redirects, token_endpoint_auth_method: "none" });
      return true;
    }
    if ((req.method === "GET" || req.method === "POST") && path === "/oauth/authorize") {
      if (!this.ready) { send(res, 503, { error: "owner_not_configured" }); return true; }
      const fields = req.method === "GET" ? url.searchParams : await this.form(req);
      const grant = this.grant(fields);
      if (!grant) { send(res, 400, { error: "invalid_authorization_request" }); return true; }
      if (req.method === "POST") {
        if (!this.attempt() || !this.password(fields.get("password") ?? "")) {
          res.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          res.end("密钥错误或尝试太频繁。请返回重试。"); return true;
        }
        for (const [key, code] of this.codes) if (code.expiresAt < Date.now()) this.codes.delete(key);
        const code = encode(randomBytes(32));
        this.codes.set(code, { ...grant, expiresAt: Date.now() + 5 * 60_000 });
        const target = new URL(grant.redirectUri);
        target.searchParams.set("code", code);
        if (grant.state) target.searchParams.set("state", grant.state);
        res.writeHead(302, { location: target.toString(), "cache-control": "no-store" }).end();
        return true;
      }
      const hidden = [...fields.entries()].filter(([name]) => name !== "password")
        .map(([name, value]) => `<input type="hidden" name="${clean(name)}" value="${clean(value)}">`).join("");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
      res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接分你一只耳机</title><style>body{font:16px system-ui;max-width:26rem;margin:3rem auto;padding:1rem}input,button{font:inherit;padding:.8rem;width:100%;box-sizing:border-box;margin:.5rem 0}</style><h1>连接分你一只耳机</h1><p>输入你在 Render 环境变量中设置的专属密钥，授权 ChatGPT 访问。密钥不会发到聊天。</p><form method="post" action="/oauth/authorize">${hidden}<input type="password" name="password" required autocomplete="off" placeholder="专属密钥"><button>连接 ChatGPT</button></form></html>`);
      return true;
    }
    if (req.method === "POST" && path === "/oauth/token") {
      if (!this.ready) { send(res, 503, { error: "owner_not_configured" }); return true; }
      const fields = await this.form(req);
      const clientId = fields.get("client_id") ?? "";
      if (!this.clientRedirect(clientId)) { send(res, 400, { error: "invalid_client" }); return true; }
      const grantType = fields.get("grant_type");
      if (grantType === "authorization_code") {
        const code = fields.get("code") ?? "";
        const pending = this.codes.get(code);
        this.codes.delete(code);
        const verifier = fields.get("code_verifier") ?? "";
        if (!pending || pending.expiresAt < Date.now() || pending.clientId !== clientId
          || pending.redirectUri !== fields.get("redirect_uri") || pending.resource !== fields.get("resource")
          || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
          || encode(createHash("sha256").update(verifier).digest()) !== pending.challenge) {
          send(res, 400, { error: "invalid_grant" }); return true;
        }
      } else if (grantType === "refresh_token") {
        if (fields.get("resource") !== this.origin
          || !this.valid(fields.get("refresh_token") ?? "", "refresh", clientId)) {
          send(res, 400, { error: "invalid_grant" }); return true;
        }
      } else { send(res, 400, { error: "unsupported_grant_type" }); return true; }
      send(res, 200, { access_token: this.token("access", 3600, clientId), token_type: "Bearer", expires_in: 3600,
        refresh_token: this.token("refresh", 30 * 86400, clientId), scope: "music" });
      return true;
    }
    if (req.method === "POST" && path === "/login/unlock") {
      if (!this.ready) { send(res, 503, { error: "owner_not_configured" }); return true; }
      if (req.headers.origin && req.headers.origin !== this.origin) {
        send(res, 403, { error: "invalid_origin" }); return true;
      }
      const body = await readJson() as { secret?: unknown };
      if (!this.attempt() || typeof body.secret !== "string" || !this.password(body.secret)) {
        send(res, 401, { error: "unauthorized" }); return true;
      }
      res.setHeader("Set-Cookie", `cove_admin=${this.token("admin", 30 * 86400)}; HttpOnly; Secure; SameSite=Strict; Path=/login; Max-Age=2592000`);
      send(res, 200, { ok: true }); return true;
    }
    return false;
  }
}
