import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const VERSION = "v1";
const AAD = Buffer.from("cove-resonance/netease-cookie/v1", "utf8");
const SALT = "cove-resonance/netease-cookie/seal";

function keyFromSecret(secret: string): Buffer {
  if (!secret.trim()) throw new Error("credential_seal_secret_missing");
  return scryptSync(secret, SALT, 32);
}

function assertCookie(cookie: string): string {
  const value = cookie.trim();
  if (!/(?:^|;\s*)MUSIC_U=/.test(value)) {
    throw new Error("netease_cookie_invalid");
  }
  return value;
}

export function sealNeteaseCookie(cookie: string, secret: string): string {
  const plaintext = Buffer.from(assertCookie(cookie), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function unsealNeteaseCookie(sealed: string, secret: string): string {
  if (sealed.length > 32_768) throw new Error("credential_seal_too_large");
  const parts = sealed.trim().split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("credential_seal_invalid");
  }
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("credential_seal_invalid");
    }
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return assertCookie(plaintext);
  } catch {
    throw new Error("credential_seal_invalid");
  }
}

export function restoreNeteaseCookieFromEnvironment(env: NodeJS.ProcessEnv): boolean {
  if (env.NETEASE_COOKIE?.trim()) return true;
  const sealed = env.NETEASE_COOKIE_SEALED?.trim() ?? "";
  const secret = env.BRIDGE_OWNER_SECRET?.trim() ?? "";
  if (!sealed || !secret) return false;
  env.NETEASE_COOKIE = unsealNeteaseCookie(sealed, secret);
  return true;
}
