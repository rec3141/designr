import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getBoardByPath } from "@/lib/pinterest";

// Resolve a Pinterest board URL or username/board-slug path to a Board object.
// Accepts: ?url=https://pinterest.com/username/boardname/
//      or: ?path=username/boardname
export async function GET(req: NextRequest) {
  const session = await getSession();
  const token = session.pinterest?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  const rawPath = req.nextUrl.searchParams.get("path") ?? "";

  let boardPath: string | null = null;

  if (rawUrl) {
    // Parse pinterest.com/{username}/{board-slug}/ from various URL formats.
    try {
      const u = new URL(rawUrl);
      if (!u.hostname.includes("pinterest")) {
        return NextResponse.json({ error: "Not a Pinterest URL" }, { status: 400 });
      }
      // Path is like /username/board-slug/ or /pin/123/ etc.
      const segments = u.pathname.split("/").filter(Boolean);
      // Must have at least username + board slug. Reject /pin/... paths.
      if (segments.length >= 2 && segments[0] !== "pin") {
        boardPath = `${segments[0]}/${segments[1]}`;
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  } else if (rawPath) {
    // Direct username/board-slug input.
    const segments = rawPath.split("/").filter(Boolean);
    if (segments.length >= 2) {
      boardPath = `${segments[0]}/${segments[1]}`;
    }
  }

  if (!boardPath) {
    return NextResponse.json(
      { error: "Provide ?url=<pinterest board URL> or ?path=<username/board-slug>" },
      { status: 400 }
    );
  }

  try {
    const board = await getBoardByPath(token, boardPath);
    return NextResponse.json({ board });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    // Pinterest returns 404 for boards that don't exist or aren't accessible.
    const status = msg.includes("404") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
