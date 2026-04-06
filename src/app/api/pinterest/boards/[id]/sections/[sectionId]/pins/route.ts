import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { listSectionPins } from "@/lib/pinterest";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; sectionId: string } }
) {
  const token = await requireAuth();
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const pins = await listSectionPins(token, params.id, params.sectionId);
    return NextResponse.json({ pins });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
