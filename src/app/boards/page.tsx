"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board } from "@/lib/types";

export default function BoardsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [resolving, setResolving] = useState(false);

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

  async function resolveUrl() {
    const input = urlInput.trim();
    if (!input) return;
    setResolving(true);
    setError(null);
    try {
      // Determine if it's a full URL or a username/board-slug path.
      const param = input.includes("://")
        ? `url=${encodeURIComponent(input)}`
        : `path=${encodeURIComponent(input)}`;
      const res = await fetch(`/api/pinterest/boards/resolve?${param}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not find that board");
      const board = j.board as Board;
      router.push(`/swipe/${board.id}?name=${encodeURIComponent(board.name)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resolve board");
    } finally {
      setResolving(false);
    }
  }

  return (
    <main className="container">
      <div className="toolbar">
        <h2>Pick a board to swipe</h2>
        <button className="btn ghost" onClick={() => router.push("/library")}>
          Library
        </button>
      </div>

      {/* Board URL input hidden until Pinterest app is verified.
      <div className="url-input-row">
        <input
          className="url-input"
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && resolveUrl()}
          placeholder="Paste any Pinterest board URL or username/board-name"
        />
        <button className="btn" onClick={resolveUrl} disabled={resolving || !urlInput.trim()}>
          {resolving ? "Loading…" : "Go"}
        </button>
      </div>
      */}

      {error && <div className="error">{error}</div>}
      {!boards && !error && <div className="notice"><span className="spinner" /> Loading your boards…</div>}
      {boards && boards.length === 0 && (
        <div className="notice">No boards found on your account.</div>
      )}
      {boards && boards.length > 0 && (
        <>
          <h3 style={{ color: "var(--muted)", fontSize: 14, margin: "20px 0 8px" }}>Your boards</h3>
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
        </>
      )}
    </main>
  );
}
