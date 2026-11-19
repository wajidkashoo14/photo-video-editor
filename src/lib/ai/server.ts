/**
 * Server-only AI provider layer. API keys are read from environment variables here and
 * never reach the browser. To add a provider, implement `AIProvider` and append it to
 * PROVIDERS; routes and UI pick it up through `capabilityStatus()`.
 */
import "server-only";

export type Capability = "text-to-image" | "image-edit" | "transcribe";

export interface ImageResult { mime: string; base64: string }

export interface AIProvider {
  id: string;
  label: string;
  /** Name of the environment variable that enables this provider. */
  envKey: string;
  capabilities: Capability[];
  isConfigured(): boolean;
  textToImage?(input: { prompt: string; size: string }): Promise<ImageResult>;
  imageEdit?(input: { prompt: string; image: Blob; mask?: Blob | null; size: string }): Promise<ImageResult>;
  /** Returns subtitles in SubRip (.srt) format. */
  transcribe?(input: { audio: Blob; language?: string }): Promise<string>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

async function openaiError(res: Response): Promise<never> {
  let detail = "";
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    /* body was not JSON */
  }
  if (res.status === 401) throw new ProviderError("The OpenAI API key was rejected. Check OPENAI_API_KEY.", 502);
  if (res.status === 429) throw new ProviderError("The AI provider is rate limiting or out of quota. Try again later.", 429);
  throw new ProviderError(detail || `The AI provider returned an error (${res.status}).`, 502);
}

const openai: AIProvider = {
  id: "openai",
  label: "OpenAI",
  envKey: "OPENAI_API_KEY",
  capabilities: ["text-to-image", "image-edit", "transcribe"],
  isConfigured: () => !!process.env.OPENAI_API_KEY,

  async textToImage({ prompt, size }) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1", prompt, size, n: 1 }),
    });
    if (!res.ok) await openaiError(res);
    const b64 = ((await res.json()) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("The AI provider returned no image.");
    return { mime: "image/png", base64: b64 };
  },

  async imageEdit({ prompt, image, mask, size }) {
    const form = new FormData();
    form.set("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("image", image, "image.png");
    if (mask) form.set("mask", mask, "mask.png");
    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (!res.ok) await openaiError(res);
    const b64 = ((await res.json()) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("The AI provider returned no image.");
    return { mime: "image/png", base64: b64 };
  },

  async transcribe({ audio, language }) {
    const form = new FormData();
    form.set("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
    form.set("response_format", "srt");
    if (language) form.set("language", language);
    form.set("file", audio, "audio.wav");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (!res.ok) await openaiError(res);
    return res.text();
  },
};

export const PROVIDERS: AIProvider[] = [openai];

export function providerFor(cap: Capability): AIProvider | null {
  const preferred = process.env.AI_PROVIDER;
  const ok = PROVIDERS.filter((p) => p.capabilities.includes(cap) && p.isConfigured());
  return ok.find((p) => p.id === preferred) ?? ok[0] ?? null;
}

/** What the UI is allowed to know: which features work and which env var would enable them. Never the key. */
export function capabilityStatus(): Record<Capability, { available: boolean; provider: string | null; needs: string[] }> {
  const caps: Capability[] = ["text-to-image", "image-edit", "transcribe"];
  return Object.fromEntries(
    caps.map((c) => {
      const p = providerFor(c);
      return [c, { available: !!p, provider: p?.label ?? null, needs: PROVIDERS.filter((x) => x.capabilities.includes(c)).map((x) => x.envKey) }];
    }),
  ) as ReturnType<typeof capabilityStatus>;
}

/* ---- request guards shared by the routes ---- */
const hits = new Map<string, { n: number; reset: number }>();

/** Fixed-window limiter (per server instance). Put a shared store such as Redis in front for multi-instance deployments. */
export function rateLimit(req: Request, limit = Number(process.env.AI_RATE_LIMIT_PER_MIN || 10)): boolean {
  // Trust what the nearest proxy saw: X-Real-IP, else the last X-Forwarded-For hop.
  // Earlier hops are supplied by the client and can be forged to dodge the limit.
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const ip = req.headers.get("x-real-ip")?.trim() || hops[hops.length - 1] || "local";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return true;
  }
  return ++h.n <= limit;
}

/** Rejects cross-site form posts: the browser must be calling from this app's own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients send no Origin; they cannot ride a user's session
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function guard(req: Request): Response | null {
  if (!sameOrigin(req)) return json({ error: "Cross-origin requests are not allowed." }, 403);
  if (!rateLimit(req)) return json({ error: "Too many AI requests. Wait a minute and try again." }, 429);
  return null;
}

export function fail(e: unknown): Response {
  if (e instanceof ProviderError) return json({ error: e.message }, e.status);
  console.error("[ai]", e);
  return json({ error: "The AI request failed unexpectedly." }, 500);
}
