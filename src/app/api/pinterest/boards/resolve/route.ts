import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { resolveBoardFromPage, getBoardById } from "@/lib/pinterest";

// Resolve a Pinterest board URL or username/board-slug to a Board object.
// Accepts: ?url=https://pinterest.com/username/boardname/
//      or: ?path=username/boardname
//
// Flow: scrape the public Pinterest page for the numeric board ID, then
// fetch full board details via the v5 API with the authenticated user's token.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const token = session.pinterest?.accessToken;
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  const rawPath = req.nextUrl.searchParams.get("path") ?? "";

  let pageUrl: string | null = null;

  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (!u.hostname.includes("pinterest")) {
        return NextResponse.json(
          { error: "Not a Pinterest URL" },
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
