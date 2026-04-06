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
      <a
        href="https://designr.quest/privacy"
        className="btn ghost"
        target="_blank"
        rel="noreferrer"
      >
        Privacy
      </a>
      <a href="mailto:hello@designr.quest" className="btn ghost">
        Contact
      </a>
      <Link href="/boards" className="btn ghost">Boards</Link>
      {authed && (
        <button className="btn ghost" onClick={logout}>
          Log out
        </button>
      )}
    </nav>
  );
}
