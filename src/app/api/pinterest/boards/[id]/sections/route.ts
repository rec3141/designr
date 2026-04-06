import { NextRequest, NextResponse } from "next/server";
import { getSession, requireAuth } from "@/lib/session";
import {
  listBoardSections,
  scrapeBoardSections,
  getBoardById,
} from "@/lib/pinterest";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await requireAuth();
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const session = await getSession(); // for username fallback

  try {
    let sections = await listBoardSections(token, params.id);
    if (sections.length === 0) {
      return NextResponse.json({ sections });
    }

    // The v5 API frequently returns empty section titles. Enrich from
    // the board's public page HTML where the __PWS_DATA__ blob has
    // proper names.
    const needsEnrichment = sections.some(
      (s) => !s.title || s.title === "Untitled"
    );
    if (needsEnrichment) {
      // Try to build the board page URL. We need owner username + slug.
      let username: string | undefined;
      let boardName: string | undefined;
      try {
        const board = await getBoardById(token, params.id);
        username = board.ownerUsername;
        boardName = board.name;
      } catch {
        // v5 board lookup failed — fall through to session username
      }
      username = username || session.pinterest?.username;

      if (username && boardName) {
        const slug = boardName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const pageUrl = `https://www.pinterest.com/${username}/${slug}/`;
        try {
          const scraped = await scrapeBoardSections(pageUrl);
          if (scraped.length > 0) {
            const map = new Map(scraped.map((s) => [s.id, s]));
            for (const s of sections) {
              const enriched = map.get(s.id);
              if (enriched?.title) s.title = enriched.title;
              if (enriched?.pinCount != null) s.pinCount = enriched.pinCount;
            }
          } else {
            console.warn("[sections] scrape returned 0 sections from", pageUrl);
          }
        } catch (e) {
          console.error("[sections] scrape failed for", pageUrl, e);
        }
      } else {
        console.warn(
          "[sections] cannot build scrape URL: username=",
          username,
          "boardName=",
          boardName
        );
      }
    }

    return NextResponse.json({ sections });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
