import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listBoards } from "@/lib/pinterest";

export async function GET() {
  const session = await getSession();
  const token = session.pinterest?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const boards = await listBoards(token);
    return NextResponse.json({ boards });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
