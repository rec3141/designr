import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import ThemeTuner from "@/components/ThemeTuner";

export const metadata: Metadata = {
  title: "designr",
  description: "Swipe through Pinterest boards and discover your style.",
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
          <nav style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link href="/boards" className="btn ghost">Boards</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
