import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type AppSession = {
  pinterest?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number; // epoch ms
    scope?: string;
    userId?: string;
    username?: string;
  };
  oauthState?: string;
};

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET env var is required. Generate one with: openssl rand -base64 32"
    );
  }
  return secret;
}

export const sessionOptions: SessionOptions = {
  password: requireSessionSecret(),
  cookieName: "designr_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

export async function getSession() {
  return getIronSession<AppSession>(cookies(), sessionOptions);
}

// Convenience: returns the access token if the session is valid and not
// expired, or null. Use this in API routes that need auth.
export async function requireAuth(): Promise<string | null> {
  const session = await getSession();
  const p = session.pinterest;
  if (!p?.accessToken) return null;
  if (p.expiresAt && p.expiresAt < Date.now()) return null;
  return p.accessToken;
}
