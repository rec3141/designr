import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listBoardSections, scrapeBoardSections, getBoardById } from "@/lib/pinterest";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const token = session.pinterest?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    let sections = await listBoardSections(token, params.id);

    // The v5 API often returns empty titles. If so, try to get proper
    // titles by scraping the board's public HTML page.
    if (sections.length > 0 && sections.every((s) => s.title === "Untitled")) {
      try {
        // We need the board's vanity URL to scrape. Get it from the v5 API.
        const board = await getBoardById(token, params.id);
        // Pinterest doesn't return the vanity URL directly, but we can
        // use the owner username. Alternatively, try the board's privacy
        // URL pattern. For now, use the session username.
        const username = session.pinterest?.username;
        if (username && board.name) {
          const slug = board.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
          const pageUrl = `https://www.pinterest.com/${username}/${slug}/`;
          const scraped = await scrapeBoardSections(pageUrl);
          if (scraped.length > 0) {
            // Match by ID and enrich v5 results.
            const map = new Map(scraped.map((s) => [s.id, s]));
            for (const s of sections) {
              const enriched = map.get(s.id);
              if (enriched?.title) s.title = enriched.title;
              if (enriched?.pinCount != null) s.pinCount = enriched.pinCount;
            }
          }
        }
      } catch { /* scraping failed — keep what v5 gave us */ }
    }

    return NextResponse.json({ sections });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
