import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { createBoard, createPinOnBoard } from "@/lib/pinterest";
import type { Pin } from "@/lib/types";

type Body = {
  name: string;
  description?: string;
  pins: Pin[];
};

export async function POST(req: NextRequest) {
  const token = await requireAuth();
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.name || !Array.isArray(body.pins) || body.pins.length === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    // Pinterest rejects duplicate board names (code 58). Auto-suffix until
    // we find a free slot so the user doesn't have to babysit naming.
    let board;
    let attempt = 0;
    const baseName = body.name;
    while (true) {
      const name = attempt === 0 ? baseName : `${baseName} (${attempt + 1})`;
      try {
        board = await createBoard(token, name, body.description);
        break;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        const isDuplicate = /already have a board with this name/i.test(msg);
        if (!isDuplicate || attempt >= 20) throw e;
        attempt++;
      }
    }
    const results: Array<{ ok: boolean; error?: string }> = [];
    const errorSamples: string[] = [];
    for (const p of body.pins) {
      try {
        await createPinOnBoard(token, board.id, {
          sourcePinId: p.id,
          title: p.title ?? undefined,
          description: p.description ?? undefined,
          link: p.link ?? undefined,
          imageUrl: p.imageUrl,
        });
        results.push({ ok: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "failed";
        results.push({ ok: false, error: msg });
        if (errorSamples.length < 3) errorSamples.push(msg);
        console.error(`[createPinOnBoard] pin ${p.id} failed:`, msg);
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return NextResponse.json({
      board,
      succeeded,
      total: body.pins.length,
      errorSamples,
      results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    console.error("[create board] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
