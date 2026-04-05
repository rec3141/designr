import { NextRequest, NextResponse } from "next/server";
import { analyzeStyle } from "@/lib/openrouter";
import type { SwipeEntry } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: { entries: SwipeEntry[]; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: "no_entries" }, { status: 400 });
  }
  try {
    const analysis = await analyzeStyle(body.entries, body.model);
    return NextResponse.json({ analysis });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const maxDuration = 60;
