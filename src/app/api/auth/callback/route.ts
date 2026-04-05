import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exchangeCodeForToken, getCurrentUser } from "@/lib/pinterest";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const session = await getSession();

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, url.origin));
  }
  if (!code || !state || state !== session.oauthState) {
    return NextResponse.redirect(new URL("/?error=invalid_state", url.origin));
  }

  try {
    const tok = await exchangeCodeForToken(code);
    // Fetch the Pinterest user id up front so the persistence layer can key
    // on it. Non-fatal — if this call fails we still let the user in, they
    // just won't get cross-device session history.
    let userId: string | undefined;
    let username: string | undefined;
    try {
      const u = await getCurrentUser(tok.access_token);
      userId = u.id;
      username = u.username;
    } catch {
      // ignore — user_account:read scope may be missing or rate-limited
    }
    session.pinterest = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + tok.expires_in * 1000,
      scope: tok.scope,
      userId,
      username,
    };
    session.oauthState = undefined;
    await session.save();
    return NextResponse.redirect(new URL("/boards", url.origin));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, url.origin));
  }
}
