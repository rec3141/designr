import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  const authed = !!session.pinterest?.accessToken && session.pinterest.expiresAt > Date.now();
  return NextResponse.json({ authed });
}
