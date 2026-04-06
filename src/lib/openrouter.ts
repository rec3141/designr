import type { Pin, SwipeEntry, SwipeChoice, UserId } from "./types";
import { choiceLabel } from "./types";

function isSuper(c: SwipeChoice): boolean {
  return c === "superlike" || c === "superdislike";
}

// Claude's hard limit is 100 images per message and cost scales linearly,
// so we cap there for Claude and a small allowlist of other large-context
// vision models. Most other models — and effectively every `:free` model —
// have much lower per-request image caps (Nvidia ~10, Gemma 32, various
// unknown). We use a conservative floor of 8 for everything unknown.
export const MAX_IMAGES = 100;
export const FREE_MODEL_IMAGE_CAP = 8;

// Lookup the per-request image cap for a given model id. Unknown models
// fall through to the conservative floor.
export function getImageCap(modelId: string): number {
  const id = modelId.toLowerCase();
  // Claude family — all known to accept 100 images per request.
  if (id.startsWith("anthropic/")) return 100;
  // OpenAI vision-capable chat models.
  if (id.startsWith("openai/gpt-4o") || id.startsWith("openai/gpt-4-vision"))
    return 100;
  // Gemini Pro tiers (not Flash, not Gemma variants).
  if (/^google\/gemini-(1\.5|2\.0|2\.5)-pro/.test(id)) return 100;
  return FREE_MODEL_IMAGE_CAP;
}

// Pinterest's CDN exposes path-based size variants. `/originals/` pins can
// easily be >2000px on either axis, which trips Claude's many-image mode
// (max 2000px per dimension in batched requests). Rewriting to `/736x/`
// yields a ≤736px variant at zero cost — no resize proxy needed. Safe for
// every free model's cap too. Only touches i.pinimg.com URLs.
export function normalizeImageUrl(url: string): string {
  return url.replace(
    /^(https?:\/\/i\.pinimg\.com\/)[^/]+\//,
    "$1736x/"
  );
}

// Pick `n` items from `arr` with an even stride so we get a representative
// spread rather than the first n.
function strideSample<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return arr.slice();
  if (n <= 0) return [];
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  return out;
}

// Smart subsampling: always keep every super-like and super-dislike (those are
// the user's strongest signals), then fill the remaining slots with a
// proportional, evenly-strided sample of regular likes and dislikes. If there
// are more super-choices than the cap, proportionally subsample those too.
export function subsampleEntries(entries: SwipeEntry[], cap = MAX_IMAGES): SwipeEntry[] {
  if (entries.length <= cap) return entries;

  // Preserve original order for stable output.
  const withIndex = entries.map((e, i) => ({ e, i }));
  const superLikes = withIndex.filter((x) => x.e.choice === "superlike");
  const superDislikes = withIndex.filter((x) => x.e.choice === "superdislike");
  const likes = withIndex.filter((x) => x.e.choice === "like");
  const dislikes = withIndex.filter((x) => x.e.choice === "dislike");

  const totalSupers = superLikes.length + superDislikes.length;

  let picked: typeof withIndex;

  if (totalSupers >= cap) {
    // Too many supers — subsample them proportionally, drop the rest entirely.
    const slSlots = Math.round((cap * superLikes.length) / totalSupers);
    const sdSlots = cap - slSlots;
    picked = [
      ...strideSample(superLikes, slSlots),
      ...strideSample(superDislikes, sdSlots),
    ];
  } else {
    // Keep every super, split the remaining budget between likes and dislikes
    // proportionally to how many the user actually made.
    const remaining = cap - totalSupers;
    const totalRegular = likes.length + dislikes.length;
    let likeSlots: number, dislikeSlots: number;
    if (totalRegular === 0) {
      likeSlots = 0;
      dislikeSlots = 0;
    } else {
      likeSlots = Math.round((remaining * likes.length) / totalRegular);
      dislikeSlots = remaining - likeSlots;
    }
    picked = [
      ...superLikes,
      ...superDislikes,
      ...strideSample(likes, likeSlots),
      ...strideSample(dislikes, dislikeSlots),
    ];
  }

  // Restore the user's original swipe order — the AI reads sequences better
  // than shuffled buckets.
  picked.sort((a, b) => a.i - b.i);
  return picked.map((x) => x.e);
}

// 2P sessions produce one SwipeEntry per (user, pin) pair — which means the
// same pin gets sent to the model twice if we naively iterate entries. This
// groups by pin id so we can send each image once with both users' verdicts
// in a stacked label.
export type PinGroup = {
  pin: Pin;
  verdicts: Array<{ userId?: UserId; choice: SwipeChoice; note?: string }>;
  firstIndex: number;
  hasSuper: boolean;
};

export function groupEntriesByPin(entries: SwipeEntry[]): PinGroup[] {
  const map = new Map<string, PinGroup>();
  entries.forEach((e, i) => {
    const g = map.get(e.pin.id);
    const verdict = { userId: e.userId, choice: e.choice, note: e.note };
    if (g) {
      g.verdicts.push(verdict);
      if (isSuper(e.choice)) g.hasSuper = true;
    } else {
      map.set(e.pin.id, {
        pin: e.pin,
        verdicts: [verdict],
        firstIndex: i,
        hasSuper: isSuper(e.choice),
      });
    }
  });
  return [...map.values()].sort((a, b) => a.firstIndex - b.firstIndex);
}

// Group-level subsampling: keep every pin that any user flagged as super,
// then fill remaining slots with a stride sample of the rest. Simpler than
// the per-entry version because 2P disagreements already live inside each
// group, so we don't need to split likes/dislikes proportionally.
export function subsampleGroups(groups: PinGroup[], cap: number): PinGroup[] {
  if (groups.length <= cap) return groups;
  const supers = groups.filter((g) => g.hasSuper);
  const rest = groups.filter((g) => !g.hasSuper);
  let picked: PinGroup[];
  if (supers.length >= cap) {
    picked = strideSample(supers, cap);
  } else {
    picked = [...supers, ...strideSample(rest, cap - supers.length)];
  }
  return picked.sort((a, b) => a.firstIndex - b.firstIndex);
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

export function resolveModel(modelOverride?: string): string {
  return (
    modelOverride?.trim() ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_MODEL
  );
}

// Apply Pinterest URL normalization to every image_url in a message list.
// Leaves text parts and non-Pinterest images (e.g. chat data: URLs) alone.
function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    return {
      ...m,
      content: m.content.map((part) =>
        part.type === "image_url"
          ? {
              ...part,
              image_url: { url: normalizeImageUrl(part.image_url.url) },
            }
          : part
      ),
    };
  });
}

export type ChatCompletionResult = {
  content: string;
  modelUsed: string;
};

export async function chatCompletion(
  messages: ChatMessage[],
  modelOverride?: string
): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");
  const primary = resolveModel(modelOverride);
  const fallback = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  // Only build a fallback chain when the user picked a non-default model.
  // OpenRouter's `models` array is tried in order on upstream failure.
  const body: Record<string, unknown> = {
    messages: normalizeMessages(messages),
    temperature: 0.7,
  };
  if (primary !== fallback) {
    body.models = [primary, fallback];
  } else {
    body.model = primary;
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://app.designr.quest",
      "X-Title": "designr",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  return {
    content: json.choices?.[0]?.message?.content?.trim() ?? "(no response)",
    modelUsed: json.model ?? primary,
  };
}

export const DUAL_ANALYSIS_SYSTEM_PROMPT =
  "You are a thoughtful visual style analyst. Two people — User A and User B — just swiped through the same mood board together, and you're writing a joint style portrait that identifies both their shared ground and where they diverge. Write in second person plural when discussing overlap ('you both gravitate toward…'), and name the users explicitly when discussing their individual territory ('A is drawn to…', 'B pushes away from…').\n\n" +
  "Each image is shown exactly once, preceded by one line per user describing their reaction in the format [A][VERDICT] — note: ... and [B][VERDICT] — note: .... VERDICT is one of SUPERLIKE, LIKE, DISLIKE, SUPERDISLIKE. When the two users disagree on the same image, that disagreement is gold for the analysis. Weight SUPERLIKE and SUPERDISLIKE much more heavily. However, DO NOT use the words 'like', 'dislike', 'superlike', or 'superdislike' in your response — describe reactions in natural language.\n\n" +
  "**Format your response as Markdown.** Use the exact section structure below:\n\n" +
  "## Shared ground\nOne paragraph describing the aesthetic territory both users share — recurring themes, colors, moods, compositional tendencies they both respond to. Be specific.\n\n" +
  "## A's territory\nA short paragraph about what User A is drawn to that B isn't (or actively rejects).\n\n" +
  "## B's territory\nThe mirror analysis for User B.\n\n" +
  "## Shared search keywords\nA comma-separated list of 6–10 searchable design style terms or concrete keywords that capture the overlap (e.g. wabi-sabi, raw concrete, mid-century modern, moody tungsten lighting).\n\n" +
  "## Palettes you'd both love\nExactly 3 palette lines. Each palette is formatted as: **<evocative 2–3 word name>:** `#RRGGBB` `#RRGGBB` `#RRGGBB` `#RRGGBB` `#RRGGBB` (exactly five hex codes per palette). The palettes should capture the shared sensibility.\n\n" +
  "Do not restate the instructions. Do not add any sections beyond those listed above.";

export const ANALYSIS_SYSTEM_PROMPT =
  "You are a thoughtful visual style analyst writing a personal style portrait for someone who just swiped through a mood board. Write in second person, addressing the reader directly as 'you' — never 'the user' or 'this person'.\n\n" +
  "Each image you are shown is tagged internally with one of four verdicts — SUPERLIKE, LIKE, DISLIKE, SUPERDISLIKE — representing how strongly they reacted. Weight SUPERLIKE and SUPERDISLIKE much more heavily than the regular ones; those are the clearest signals. However, DO NOT use the words 'like', 'dislike', 'superlike', or 'superdislike' in your response. Describe attractions and rejections in natural language instead ('you gravitate toward…', 'what pulls you in is…', 'what you push away from is…', 'you have no patience for…').\n\n" +
  "**Format your response as Markdown.** Use the exact section structure below:\n\n" +
  "## Style portrait\nTwo paragraphs. Identify recurring aesthetic themes, color palettes, materials, moods, and compositional tendencies they gravitate toward, and contrast with what they reject. Be specific and evocative, not generic.\n\n" +
  "## Adjacent styles\nA comma-separated list of 6–10 named design styles, movements, or searchable aesthetic keywords that are close to what you gravitate toward (e.g. wabi-sabi, brutalism, Japandi, mid-century modern, cottagecore, dark academia). Crisp search terms someone could type into Pinterest or Google.\n\n" +
  "## Search keywords\nA comma-separated list of 6–10 more specific concrete nouns and phrase keywords for finding more of what you'd love (materials, textures, objects, moods — e.g. raw concrete, weathered brass, linen drapery, moody tungsten lighting).\n\n" +
  "## Palettes you'd love\nExactly 3 palette lines. Each palette is formatted as: **<evocative 2–3 word name>:** `#RRGGBB` `#RRGGBB` `#RRGGBB` `#RRGGBB` `#RRGGBB` (exactly five hex codes per palette). The palettes should each capture a different facet of your sensibility. Use hex codes only — no rgb(), no names.\n\n" +
  "Do not restate the instructions. Do not add any sections beyond those listed above.";

export type AnalyzeResult = {
  analysis: string;
  modelUsed: string;
};

export async function analyzeStyle(
  entries: SwipeEntry[],
  modelOverride?: string,
  userNames?: { A?: string; B?: string },
): Promise<AnalyzeResult> {
  // Detect dual-user sessions by presence of userId tags.
  const isDual = entries.some((e) => e.userId);

  // Resolve display names — fall back to generic "User A" / "User B" / "you".
  const nameA = userNames?.A || "User A";
  const nameB = userNames?.B || "User B";
  const soloName = userNames?.A || undefined; // undefined = generic "you"

  // Per-model image cap — Claude handles 100, most free models 8 or so.
  const primary = resolveModel(modelOverride);
  const cap = getImageCap(primary);

  const leadText = isDual
    ? `Here are the images with verdicts and notes from both users. ${nameA} is User A, ${nameB} is User B. Each image is shown once, with each user's reaction stacked above it on its own line. Analyze their shared and divergent style.`
    : soloName
      ? `Here are the images with ${soloName}'s verdicts and notes. Analyze their style.`
      : "Here are the images with the user's verdicts and notes. Analyze their style.";

  const userContent: Exclude<ChatMessage["content"], string> = [
    { type: "text", text: leadText },
  ];

  if (isDual) {
    // Group by pin so each image is sent once with both users' verdicts
    // stacked above it — halves the image count and token cost vs. the
    // old one-entry-per-image approach.
    const groups = groupEntriesByPin(entries);
    const capped = subsampleGroups(groups, cap);
    for (const g of capped) {
      // Sort verdicts by userId so A always comes before B for stable output.
      const ordered = [...g.verdicts].sort((a, b) =>
        (a.userId ?? "").localeCompare(b.userId ?? "")
      );
      const header = g.pin.title ? `title: ${g.pin.title}` : "";
      if (header) userContent.push({ type: "text", text: header });
      for (const v of ordered) {
        const who = v.userId
          ? `[${v.userId === "A" ? nameA : nameB}]`
          : "";
        const line = `${who}[${choiceLabel(v.choice)}]${
          v.note ? ` — note: ${v.note}` : ""
        }`;
        userContent.push({ type: "text", text: line });
      }
      userContent.push({ type: "image_url", image_url: { url: g.pin.imageUrl } });
    }
  } else {
    // Solo mode — one entry per pin already, no grouping needed.
    const capped = subsampleEntries(entries, cap);
    for (const e of capped) {
      const label = `[${choiceLabel(e.choice)}]${e.pin.title ? ` title: ${e.pin.title}` : ""}${
        e.note ? ` — note: ${e.note}` : ""
      }`;
      userContent.push({ type: "text", text: label });
      userContent.push({ type: "image_url", image_url: { url: e.pin.imageUrl } });
    }
  }

  // Build the system prompt, injecting real names when provided.
  let systemPrompt: string;
  if (isDual) {
    systemPrompt = DUAL_ANALYSIS_SYSTEM_PROMPT
      .replace(/User A/g, nameA)
      .replace(/User B/g, nameB)
      .replace(/\bA's territory/g, `${nameA}'s territory`)
      .replace(/\bB's territory/g, `${nameB}'s territory`)
      .replace(/'A is drawn to…'/g, `'${nameA} is drawn to…'`)
      .replace(/'B pushes away from…'/g, `'${nameB} pushes away from…'`);
  } else if (soloName) {
    // Address the user by name instead of generic "you".
    systemPrompt = ANALYSIS_SYSTEM_PROMPT +
      `\n\nThe user's name is ${soloName}. You may address them by name occasionally for a personal touch, but still primarily use 'you'.`;
  } else {
    systemPrompt = ANALYSIS_SYSTEM_PROMPT;
  }

  const { content, modelUsed } = await chatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    modelOverride
  );
  return { analysis: content, modelUsed };
}

export const FOLLOWUP_SYSTEM_PROMPT =
  "You are a visual style advisor continuing a conversation about someone's aesthetic. You previously wrote a style portrait for them (it's in the conversation history as your first message). Answer follow-up questions concretely and specifically — reference named design movements, materials, brands, colors (with hex codes when useful), and practical suggestions. Write in second person ('you'). **Format your response as Markdown** — use headings, bold, and bullet points where they aid readability. Keep responses focused and skimmable — short paragraphs. When you mention color values, use hex codes like `#A3B2C1` so they render as color chips in the UI. If the user attaches an image, treat it as something they want your opinion on or want you to relate to their established style. Never use the words 'like', 'dislike', 'superlike', or 'superdislike'.";
