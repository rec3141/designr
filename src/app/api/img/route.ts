import { NextRequest, NextResponse } from "next/server";

// Tiny CORS-safe image proxy so the browser canvas can sample pixels
// from Pinterest images without tainting.
export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return new NextResponse("missing u", { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }
  // Restrict to Pinterest image hosts.
  if (!/(^|\.)pinimg\.com$/i.test(parsed.hostname) && !/(^|\.)pinterest\.com$/i.test(parsed.hostname)) {
    return new NextResponse("host not allowed", { status: 400 });
  }
  const res = await fetch(parsed.toString(), { cache: "force-cache" });
  if (!res.ok) return new NextResponse("upstream error", { status: 502 });
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
