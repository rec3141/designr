import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listSessionsForUser, upsertSession } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  const userId = session.pinterest?.userId;
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const sessions = await listSessionsForUser(userId);
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = session.pinterest?.userId;
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const body = (await req.json()) as {
    id?: string;
    sourceBoardId?: string;
    sourceBoardName?: string;
    mode?: string;
    data?: unknown;
  };
  if (!body.sourceBoardId || !body.sourceBoardName || !body.data) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  // Count entries from the payload if we can — gives the library a cheap
  // summary without re-parsing the blob on list.
  let entryCount = 0;
  try {
    const d = body.data as { entries?: unknown[] };
    if (Array.isArray(d.entries)) entryCount = d.entries.length;
  } catch {
    // ignore
  }
  const id = await upsertSession({
    id: body.id,
    userId,
    sourceBoardId: body.sourceBoardId,
    sourceBoardName: body.sourceBoardName,
    mode: body.mode ?? "single",
    entryCount,
    data: JSON.stringify(body.data),
  });
  return NextResponse.json({ id });
}
