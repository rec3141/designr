import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listBoardSections } from "@/lib/pinterest";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const token = session.pinterest?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const sections = await listBoardSections(token, params.id);
    return NextResponse.json({ sections });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
