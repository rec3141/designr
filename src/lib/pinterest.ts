import type { Board, Pin } from "./types";

const API_BASE = "https://api.pinterest.com/v5";
const OAUTH_AUTHORIZE = "https://www.pinterest.com/oauth/";
const OAUTH_TOKEN = "https://api.pinterest.com/v5/oauth/token";

export const PINTEREST_SCOPES = [
  "boards:read",
  "pins:read",
  "boards:write",
  "pins:write",
  "user_accounts:read",
].join(",");

export function buildAuthorizeUrl(state: string): string {
  const clientId = requireEnv("PINTEREST_CLIENT_ID");
  const redirectUri = requireEnv("PINTEREST_REDIRECT_URI");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: PINTEREST_SCOPES,
    state,
  });
  return `${OAUTH_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}> {
  const clientId = requireEnv("PINTEREST_CLIENT_ID");
  const clientSecret = requireEnv("PINTEREST_CLIENT_SECRET");
  const redirectUri = requireEnv("PINTEREST_REDIRECT_URI");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Pinterest token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function pinterestGet<T>(token: string, path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Pinterest GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pinterestPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pinterest POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

type RawBoard = {
  id: string;
  name: string;
  description?: string | null;
  pin_count?: number;
  media?: { image_cover_url?: string | null };
};
type RawPin = {
  id: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  board_id?: string | null;
  media?: {
    images?: Record<string, { url: string; width?: number; height?: number }>;
  };
};

function pickImage(media: RawPin["media"]): string | null {
  const images = media?.images;
  if (!images) return null;
  // Prefer common sizes in order
  const prefer = ["1200x", "736x", "600x", "474x", "236x", "original"];
  for (const key of prefer) if (images[key]?.url) return images[key].url;
  const first = Object.values(images)[0];
  return first?.url ?? null;
}

export async function getCurrentUser(
  token: string
): Promise<{ id: string; username?: string }> {
  const data = await pinterestGet<{ id?: string; username?: string }>(
    token,
    "/user_account"
  );
  if (!data.id) throw new Error("Pinterest user_account returned no id");
  return { id: data.id, username: data.username };
}

export async function listBoards(token: string): Promise<Board[]> {
  const out: Board[] = [];
  let bookmark: string | undefined;
  do {
    const data: { items: RawBoard[]; bookmark?: string } = await pinterestGet(
      token,
      "/boards",
      { page_size: "100", ...(bookmark ? { bookmark } : {}) }
    );
    for (const b of data.items) {
      out.push({
        id: b.id,
        name: b.name,
        description: b.description ?? null,
        pinCount: b.pin_count,
        coverImageUrl: b.media?.image_cover_url ?? null,
      });
    }
    bookmark = data.bookmark;
  } while (bookmark);
  return out;
}

export async function listBoardPins(token: string, boardId: string, max = 200): Promise<Pin[]> {
  const out: Pin[] = [];
  let bookmark: string | undefined;
  do {
    const data: { items: RawPin[]; bookmark?: string } = await pinterestGet(
      token,
      `/boards/${boardId}/pins`,
      { page_size: "100", ...(bookmark ? { bookmark } : {}) }
    );
    for (const p of data.items) {
      const imageUrl = pickImage(p.media);
      if (!imageUrl) continue;
      out.push({
        id: p.id,
        title: p.title ?? null,
        description: p.description ?? null,
        link: p.link ?? null,
        boardId: p.board_id ?? boardId,
        imageUrl,
      });
      if (out.length >= max) return out;
    }
    bookmark = data.bookmark;
  } while (bookmark);
  return out;
}

export async function createBoard(
  token: string,
  name: string,
  description?: string
): Promise<Board> {
  const b: RawBoard = await pinterestPost(token, "/boards", {
    name,
    description: description ?? "",
    privacy: "PUBLIC",
  });
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? null,
    pinCount: b.pin_count ?? 0,
    coverImageUrl: b.media?.image_cover_url ?? null,
  };
}

export async function createPinOnBoard(
  token: string,
  boardId: string,
  pin: {
    sourcePinId?: string;
    title?: string;
    description?: string;
    link?: string;
    imageUrl: string;
  }
): Promise<{ id: string }> {
  // Prefer repin-by-id — that's what Pinterest expects when the source is
  // another pin on Pinterest. Falls back to image_url for pins whose id is
  // missing for any reason.
  const mediaSource = pin.sourcePinId
    ? { source_type: "pin_id", pin_id: pin.sourcePinId }
    : { source_type: "image_url", url: pin.imageUrl };
  return pinterestPost(token, "/pins", {
    board_id: boardId,
    title: pin.title?.slice(0, 100) || undefined,
    description: pin.description?.slice(0, 500) || undefined,
    link: pin.link || undefined,
    media_source: mediaSource,
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
