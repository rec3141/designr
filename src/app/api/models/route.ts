import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";

// OpenRouter's model catalog. We filter to free multimodal (vision-capable)
// models and then probe each candidate for live capacity so the user only
// sees models that actually respond right now — many "free" OpenRouter
// models are constantly over capacity.
type RawModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; image?: string };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

type AliveModel = { id: string; name: string; contextLength: number };

// Module-level cache: probe results are reused for CACHE_TTL_MS so we don't
// hammer OpenRouter every time the review page mounts.
const CACHE_TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 6;
let cache: { at: number; models: AliveModel[] } | null = null;
let inflight: Promise<AliveModel[]> | null = null;

async function probeModel(
  model: AliveModel,
  apiKey: string
): Promise<AliveModel | null> {
  // Minimal ping: 1-token completion. If the model is unavailable,
  // over-capacity, or has no providers, we'll get a non-2xx or an error
  // payload. Success means it's currently usable.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://app.designr.quest",
        "X-Title": "designr",
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      error?: { message?: string; code?: number | string };
      choices?: unknown[];
    };
    // OpenRouter sometimes returns 200 with an error body when all providers
    // are over capacity — treat that as dead.
    if (json.error) return null;
    if (!Array.isArray(json.choices) || json.choices.length === 0) return null;
    return model;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Tiny parallel mapper with a concurrency cap so we don't fan out 30+
// simultaneous requests.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

async function fetchAliveModels(): Promise<AliveModel[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return [];
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 }, // catalog itself is cached 1h by next
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: RawModel[] };

  const isFree = (m: RawModel) => {
    const p = m.pricing;
    if (!p) return false;
    return (
      (parseFloat(p.prompt ?? "0") || 0) === 0 &&
      (parseFloat(p.completion ?? "0") || 0) === 0 &&
      (parseFloat(p.image ?? "0") || 0) === 0
    );
  };

  const isVisionChat = (m: RawModel) => {
    const a = m.architecture;
    if (!a) return false;
    const inputs = a.input_modalities ?? [];
    const outputs = a.output_modalities ?? [];
    const inModality = a.modality ?? "";
    const hasImageIn = inputs.includes("image") || inModality.includes("image");
    const hasTextIn = inputs.includes("text") || inModality.includes("text");
    const hasTextOut =
      outputs.length === 0
        ? inModality.includes("->text") || inModality.endsWith("text")
        : outputs.includes("text");
    const producesOnlyText =
      outputs.length === 0 ? true : outputs.every((o) => o === "text");
    return hasImageIn && hasTextIn && hasTextOut && producesOnlyText;
  };

  const candidates: AliveModel[] = json.data
    .filter((m) => isFree(m) && isVisionChat(m))
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length ?? 0,
    }))
    .sort((a, b) => b.contextLength - a.contextLength);

  const probed = await mapLimit(candidates, PROBE_CONCURRENCY, (m) =>
    probeModel(m, apiKey)
  );
  return probed.filter((m): m is AliveModel => m !== null);
}

// Force dynamic — this route probes live model capacity and must not be
// prerendered at build time (Finding #5).
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth()))
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json({ models: cache.models, cached: true });
    }
    // Coalesce concurrent requests so we only run one probe sweep at a time.
    if (!inflight) {
      inflight = fetchAliveModels()
        .then((models) => {
          cache = { at: Date.now(), models };
          return models;
        })
        .finally(() => {
          inflight = null;
        });
    }
    const models = await inflight;
    return NextResponse.json({ models, cached: false });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
