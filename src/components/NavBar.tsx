"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function NavBar() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setAuthed(!!j.authed))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthed(false);
    router.push("/");
  }

  return (
    <nav style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Link href="/boards" className="btn ghost">Boards</Link>
      <Link href="/library" className="btn ghost">Library</Link>
      {authed && (
        <button className="btn ghost" onClick={logout}>
          Log out
        </button>
      )}
      <a
        href="https://designr.quest/privacy"
        className="nav-link"
        target="_blank"
        rel="noreferrer"
      >
        Privacy
      </a>
      <a href="mailto:hello@designr.quest" className="nav-link">
        Contact
      </a>
    </nav>
  );
}
