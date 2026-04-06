import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import ThemeTuner from "@/components/ThemeTuner";
import NavBar from "@/components/NavBar";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "designr for Pinterest",
  description:
    "Connect with Pinterest, swipe through your boards, and save your likes as a curated new board.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeTuner />
        <header className="header">
          <Link href="/" className="logo">
            design<span className="dot">r</span>
          </Link>
          <NavBar />
        </header>
        {children}
      </body>
    </html>
  );
}
