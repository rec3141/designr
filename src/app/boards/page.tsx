"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board } from "@/lib/types";

export default function BoardsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pinterest/boards")
      .then(async (r) => {
        if (r.status === 401) {
          router.replace("/");
          return null;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load boards");
        return j.boards as Board[];
      })
      .then((b) => b && setBoards(b))
      .catch((e) => setError(e.message));
  }, [router]);

  return (
    <main className="container">
      <div className="toolbar">
        <h2>Pick a board to swipe</h2>
        <button className="btn ghost" onClick={() => router.push("/library")}>
          Library
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!boards && !error && <div className="notice"><span className="spinner" /> Loading your boards…</div>}
      {boards && boards.length === 0 && (
        <div className="notice">No boards found on your account.</div>
      )}
      {boards && boards.length > 0 && (
        <div className="grid">
          {boards.map((b) => (
            <div
              key={b.id}
              className="board-card"
              onClick={() => router.push(`/swipe/${b.id}?name=${encodeURIComponent(b.name)}`)}
            >
              <div
                className="thumb"
                style={{
                  backgroundImage: b.coverImageUrl ? `url(${b.coverImageUrl})` : undefined,
                }}
              />
              <div className="meta">
                <h3>{b.name}</h3>
                <div className="count">{b.pinCount ?? 0} pins</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
