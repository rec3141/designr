import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSessionById, deleteSession } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session.pinterest?.userId;
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const row = await getSessionById(userId, params.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    return NextResponse.json({ error: "corrupt_data" }, { status: 500 });
  }
  return NextResponse.json({
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceBoardId: row.sourceBoardId,
    sourceBoardName: row.sourceBoardName,
    mode: row.mode,
    entryCount: row.entryCount,
    data,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session.pinterest?.userId;
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const ok = await deleteSession(userId, params.id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
