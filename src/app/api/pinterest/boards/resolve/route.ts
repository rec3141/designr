import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { resolveBoardFromPage, getBoardById } from "@/lib/pinterest";

// Resolve a Pinterest board URL or username/board-slug to a Board object.
// Accepts: ?url=https://pinterest.com/username/boardname/
//      or: ?path=username/boardname
//
// Flow: scrape the public Pinterest page for the numeric board ID, then
// fetch full board details via the v5 API with the authenticated user's token.
export async function GET(req: NextRequest) {
  const token = await requireAuth();
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  const rawPath = req.nextUrl.searchParams.get("path") ?? "";

  let pageUrl: string | null = null;

  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      // Strict allowlist — only accept actual Pinterest domains.
      // Prevents SSRF via e.g. evilpinterest.com or pinterest.evil.com.
      const allowed = ["www.pinterest.com", "pinterest.com", "pin.it"];
      if (
        !allowed.includes(u.hostname) &&
        !/^[a-z]{2}\.pinterest\.com$/.test(u.hostname) // country subdomains like uk.pinterest.com
      ) {
        return NextResponse.json(
          { error: "Not a Pinterest URL" },
          { status: 400 }
        );
      }
      if (u.protocol !== "https:") {
        return NextResponse.json(
          { error: "Only HTTPS Pinterest URLs are accepted" },
          { status: 400 }
        );
      }
      pageUrl = u.toString();
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  } else if (rawPath) {
    const segments = rawPath.split("/").filter(Boolean);
    if (segments.length >= 2) {
      pageUrl = `https://www.pinterest.com/${segments[0]}/${segments[1]}/`;
    }
  }

  if (!pageUrl) {
    return NextResponse.json(
      {
        error:
          "Provide ?url=<pinterest board URL> or ?path=<username/board-slug>",
      },
      { status: 400 }
    );
  }

  try {
    // Step 1: scrape the page for the numeric board ID.
    const { id, name } = await resolveBoardFromPage(pageUrl);

    // Step 2: try v5 API for full details (pin count, cover image).
    // This may fail for boards the user doesn't own in trial mode,
    // so we fall back gracefully.
    try {
      const board = await getBoardById(token, id);
      return NextResponse.json({ board });
    } catch {
      // Trial-mode fallback: return what we scraped.
      return NextResponse.json({
        board: { id, name, description: null, pinCount: null, coverImageUrl: null },
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
