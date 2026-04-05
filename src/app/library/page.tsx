"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SwipeSession } from "@/lib/types";

const STORAGE_KEY = "designr_swipe_session";

type Summary = {
  id: string;
  createdAt: number;
  updatedAt: number;
  sourceBoardId: string;
  sourceBoardName: string;
  mode: string;
  entryCount: number;
};

export default function LibraryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then(async (r) => {
        if (r.status === 401) {
          router.replace("/");
          return null;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load sessions");
        return j.sessions as Summary[];
      })
      .then((s) => s && setSessions(s))
      .catch((e) => setError(e.message));
  }, [router]);

  async function openSession(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load session");
      const data = j.data as SwipeSession;
      // Ensure the loaded session knows its saved id so subsequent edits
      // update the existing row.
      data.savedId = j.id;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      router.push("/review");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSession(id: string) {
    if (!confirm("Delete this saved session? This cannot be undone.")) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Delete failed");
      }
      setSessions((s) => (s ? s.filter((x) => x.id !== id) : s));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleString();
  }

  return (
    <main className="container">
      <div className="toolbar">
        <h2>Your saved sessions</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => router.push("/boards")}>
            Back to boards
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {!sessions && !error && (
        <div className="notice">
          <span className="spinner" /> Loading…
        </div>
      )}
      {sessions && sessions.length === 0 && (
        <div className="notice">
          No saved sessions yet. Finish a swipe session and it&apos;ll show up here.
        </div>
      )}
      {sessions && sessions.length > 0 && (
        <div className="library-list">
          {sessions.map((s) => (
            <div key={s.id} className="library-row">
              <div className="library-meta">
                <div className="library-name">{s.sourceBoardName}</div>
                <div className="library-sub">
                  {s.entryCount} swipes · {s.mode === "dual" ? "2P" : "solo"} ·{" "}
                  updated {fmtDate(s.updatedAt)}
                </div>
              </div>
              <div className="library-actions">
                <button
                  className="btn"
                  onClick={() => openSession(s.id)}
                  disabled={busy === s.id}
                >
                  {busy === s.id ? "Opening…" : "Open"}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => deleteSession(s.id)}
                  disabled={busy === s.id}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
