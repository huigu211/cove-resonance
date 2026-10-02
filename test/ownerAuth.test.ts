import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const origin = "https://private-cove.example";
const secret = "a-unique-owner-secret-for-integration-tests-only";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";

test("private MCP requires OAuth and validates owner login with PKCE", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    BRIDGE_PUBLIC_ORIGIN: process.env.BRIDGE_PUBLIC_ORIGIN,
    BRIDGE_OWNER_SECRET: process.env.BRIDGE_OWNER_SECRET,
  };
  process.env.NODE_ENV = "test";
  process.env.BRIDGE_PUBLIC_ORIGIN = origin;
  process.env.BRIDGE_OWNER_SECRET = secret;
  const { createHttpServer } = await import("../src/server.js");
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(base + "/mcp/music", { method: "POST" });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
    const noIngest = await fetch(base + "/events", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
    assert.equal(noIngest.status, 401);

    const registration = await fetch(base + "/oauth/register", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) });
    assert.equal(registration.status, 201);
    const client = await registration.json() as { client_id: string };
    const verifier = "safe-verifier-0123456789012345678901234567890123456";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const fields = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
      response_type: "code", code_challenge: challenge, code_challenge_method: "S256",
      resource: origin, scope: "music", state: "test-state" });
    const login = await fetch(base + "/oauth/authorize?" + fields);
    assert.equal(login.status, 200);
    assert.match(await login.text(), /连接 ChatGPT/);

    const denied = await fetch(base + "/oauth/authorize", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(fields), password: "wrong" }), redirect: "manual" });
    assert.equal(denied.status, 401);
    const approval = await fetch(base + "/oauth/authorize", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(fields), password: secret }), redirect: "manual" });
    assert.equal(approval.status, 302);
    const callback = new URL(approval.headers.get("location") ?? "");
    assert.equal(callback.origin, "https://chatgpt.com");
    assert.equal(callback.searchParams.get("state"), "test-state");
    const code = callback.searchParams.get("code") ?? "";
    assert.ok(code);

    const exchange = await fetch(base + "/oauth/token", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id,
        redirect_uri: redirectUri, code_verifier: verifier, resource: origin }) });
    assert.equal(exchange.status, 200);
    const token = await exchange.json() as { access_token: string; refresh_token: string };
    assert.ok(token.access_token);
    const refresh = await fetch(base + "/oauth/token", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id,
        refresh_token: token.refresh_token, resource: origin }) });
    assert.equal(refresh.status, 200);
    const consumed = await fetch(base + "/oauth/token", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id,
        redirect_uri: redirectUri, code_verifier: verifier, resource: origin }) });
    assert.equal(consumed.status, 400);

    const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "auth-test", version: "1" } } });
    const connected = await fetch(base + "/mcp/music", { method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json",
        accept: "application/json, text/event-stream" }, body: rpc });
    assert.equal(connected.status, 200);
    assert.equal((await connected.json() as { result?: { serverInfo?: { name?: string } } })
      .result?.serverInfo?.name, "cove-resonance-music");
    const notAnAdminCookie = await fetch(base + "/login/qr", { method: "POST",
      headers: { cookie: `cove_admin=${token.access_token}` } });
    assert.equal(notAnAdminCookie.status, 401);
    const unlock = await fetch(base + "/login/unlock", { method: "POST",
      headers: { "content-type": "application/json", origin }, body: JSON.stringify({ secret }) });
    assert.equal(unlock.status, 200);
    assert.match(unlock.headers.get("set-cookie") ?? "", /HttpOnly; Secure; SameSite=Strict/);
    assert.match(unlock.headers.get("set-cookie") ?? "", /Max-Age=2592000/);
    const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
    const restored = await fetch(base + "/login/session", { headers: { cookie } });
    assert.deepEqual(await restored.json(), { unlocked: true });
    const anonymous = await fetch(base + "/login/session");
    assert.deepEqual(await anonymous.json(), { unlocked: false });
    const statusDenied = await fetch(base + "/login/status");
    assert.equal(statusDenied.status, 401);
    const status = await fetch(base + "/login/status", { headers: { cookie } });
    assert.equal(status.status, 200);
    assert.equal(typeof (await status.json() as { accountReady: unknown }).accountReady, "boolean");
    // A server restart keeps the browser unlock valid with the same owner key.
    const { OwnerAuth } = await import("../src/ownerAuth.js");
    const restartedAuth = new OwnerAuth();
    assert.equal(restartedAuth.hasAdminSession({ headers: { cookie } } as never), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
