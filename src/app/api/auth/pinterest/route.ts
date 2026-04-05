import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/session";
import { buildAuthorizeUrl } from "@/lib/pinterest";

export async function GET() {
  const session = await getSession();
  const state = randomBytes(16).toString("hex");
  session.oauthState = state;
  await session.save();
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
