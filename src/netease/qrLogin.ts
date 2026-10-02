import { createRequire } from "node:module";

type ApiResponse = { body?: unknown };
type QrSdk = Record<string, (params: Record<string, unknown>) => Promise<ApiResponse>>;
const sdk = createRequire(import.meta.url)("NeteaseCloudMusicApi") as QrSdk;

function obj(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}

export class QrLogin {
  private key: string | null = null;
  private expiresAt = 0;
  private checking = false;

  async create(): Promise<string> {
    const key = obj(obj((await sdk.login_qr_key({})).body).data).unikey;
    if (typeof key !== "string" || !key) throw new Error("qr_key_unavailable");
    const image = obj(obj((await sdk.login_qr_create({ key, qrimg: true })).body).data).qrimg;
    if (typeof image !== "string" || !/^data:image\/png;base64,/.test(image)) {
      throw new Error("qr_image_unavailable");
    }
    this.key = key;
    this.expiresAt = Date.now() + 180_000;
    return image;
  }

  async check(): Promise<{ status: "waiting" | "scanned" | "expired" | "confirmed"; cookie?: string }> {
    if (!this.key || Date.now() >= this.expiresAt) {
      this.key = null;
      return { status: "expired" };
    }
    if (this.checking) return { status: "waiting" };
    this.checking = true;
    try {
      const body = obj((await sdk.login_qr_check({ key: this.key })).body);
      const code = Number(body.code);
      if (code === 800) { this.key = null; return { status: "expired" }; }
      if (code === 801) return { status: "waiting" };
      if (code === 802) return { status: "scanned" };
      if (code === 803) {
        this.key = null;
        const cookie = body.cookie;
        if (typeof cookie !== "string" || !/(?:^|;\s*)MUSIC_U=/.test(cookie)) {
          throw new Error("qr_cookie_unavailable");
        }
        return { status: "confirmed", cookie };
      }
      throw new Error("qr_check_unavailable");
    } finally {
      this.checking = false;
    }
  }
}
