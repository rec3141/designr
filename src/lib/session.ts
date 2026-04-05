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

export const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "insecure_dev_secret_change_me_insecure_dev_secret_change_me",
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
