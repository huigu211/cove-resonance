import assert from "node:assert/strict";
import test from "node:test";
import {
  restoreNeteaseCookieFromEnvironment,
  sealNeteaseCookie,
  unsealNeteaseCookie,
} from "../src/netease/credentialSeal.js";

const cookie = "MUSIC_U=private-session; __csrf=private-csrf";

test("sealed NetEase cookie round-trips without exposing plaintext", () => {
  const sealed = sealNeteaseCookie(cookie, "owner secret with enough entropy");
  assert.match(sealed, /^v1\./);
  assert.equal(sealed.includes("MUSIC_U"), false);
  assert.equal(unsealNeteaseCookie(sealed, "owner secret with enough entropy"), cookie);
});

test("sealed NetEase cookie rejects the wrong owner secret", () => {
  const sealed = sealNeteaseCookie(cookie, "correct owner secret");
  assert.throws(() => unsealNeteaseCookie(sealed, "wrong owner secret"), /credential_seal_invalid/);
});

test("environment restore prefers an existing raw cookie", () => {
  const env: NodeJS.ProcessEnv = {
    NETEASE_COOKIE: cookie,
    NETEASE_COOKIE_SEALED: "not-a-valid-seal",
  };
  assert.equal(restoreNeteaseCookieFromEnvironment(env), true);
  assert.equal(env.NETEASE_COOKIE, cookie);
});

test("environment restore decrypts the durable sealed value", () => {
  const secret = "owner secret";
  const env: NodeJS.ProcessEnv = {
    BRIDGE_OWNER_SECRET: secret,
    NETEASE_COOKIE_SEALED: sealNeteaseCookie(cookie, secret),
  };
  assert.equal(restoreNeteaseCookieFromEnvironment(env), true);
  assert.equal(env.NETEASE_COOKIE, cookie);
});

test("environment restore stays disabled when durable inputs are absent", () => {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(restoreNeteaseCookieFromEnvironment(env), false);
  assert.equal(env.NETEASE_COOKIE, undefined);
});
