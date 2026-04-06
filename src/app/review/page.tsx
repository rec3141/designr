"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SwipeChoice, SwipeSession, SwipeEntry } from "@/lib/types";
import { choiceLabel, isPositive } from "@/lib/types";
import Markdown from "@/components/Markdown";

type SortMode = "original" | "score";
import { resetTheme } from "@/lib/theme";

type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
};

const CHOICES: SwipeChoice[] = ["superlike", "like", "dislike", "superdislike"];
const CHOICE_GLYPH: Record<SwipeChoice, string> = {
  superlike: "★",
  like: "♥",
  dislike: "✕",
  superdislike: "⊘",
};

const MODEL_STORAGE_KEY = "designr_model";
const DEFAULT_MODEL_LABEL = "Claude Sonnet 4.6 (default, paid)";
type FreeModel = { id: string; name: string; contextLength: number };

const STORAGE_KEY = "designr_swipe_session";

async function persistSessionRemote(
  sess: SwipeSession
): Promise<string | undefined> {
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: sess.savedId,
        sourceBoardId: sess.sourceBoardId,
        sourceBoardName: sess.sourceBoardName,
        mode: sess.mode ?? "single",
        data: sess,
      }),
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { id?: string };
    return j.id;
  } catch {
    return undefined;
  }
}

export default function ReviewPage() {
  const router = useRouter();
  const [sess, setSess] = useState<SwipeSession | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced remote save. We coalesce rapid edits (typing in a note,
  // incoming chat turns, etc.) into a single backend write to avoid
  // hammering the database.
  function scheduleSave(s: SwipeSession) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const id = await persistSessionRemote(s);
      if (id && !s.savedId) {
        const updated = { ...s, savedId: id };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setSess(updated);
      }
    }, 800);
  }
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisModel, setAnalysisModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<{
    succeeded: number;
    total: number;
    boardId: string;
    errorSamples?: string[];
  } | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [freeModels, setFreeModels] = useState<FreeModel[] | null>(null);
  // Empty string = use server default (the paid model from env).
  const [modelId, setModelId] = useState<string>("");
  // Follow-up chat with the AI after the initial analysis.
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatImage, setChatImage] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("original");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      router.replace("/boards");
      return;
    }
    const s = JSON.parse(raw) as SwipeSession;
    setSess(s);
    setNewBoardName(`${s.sourceBoardName} — liked`);
    // Rehydrate analysis + chat if this session was loaded from the library.
    if (s.analysis) setAnalysis(s.analysis);
    if (s.chat && s.chat.length > 0) setChat(s.chat);
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel !== null) setModelId(savedModel);
  }, [router]);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.models)) setFreeModels(j.models);
        else setFreeModels([]);
      })
      .catch(() => setFreeModels([]));
  }, []);

  function onModelChange(v: string) {
    setModelId(v);
    localStorage.setItem(MODEL_STORAGE_KEY, v);
  }

  function updateEntry(i: number, patch: Partial<SwipeSession["entries"][number]>) {
    if (!sess) return;
    const next: SwipeSession = {
      ...sess,
      entries: sess.entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    };
    setSess(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    scheduleSave(next);
  }

  async function analyze() {
    if (!sess) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setAnalysisModel(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: sess.entries,
          model: modelId || undefined,
          userNames: sess.userNames,
          mode: sess.mode,
        }),
      });
      const text = await res.text();
      let j: { analysis: string; modelUsed?: string; error?: string };
      try { j = JSON.parse(text); } catch {
        throw new Error(res.ok ? "Invalid response from server" : `Server error (${res.status})`);
      }
      if (!res.ok) throw new Error(j.error || "Analysis failed");
      setAnalysis(j.analysis);
      if (j.modelUsed) setAnalysisModel(j.modelUsed);
      // Seed the chat with the analysis as the first assistant turn so the
      // model has its own context when the user asks follow-ups.
      const seeded: ChatTurn[] = [{ role: "assistant", text: j.analysis }];
      setChat(seeded);
      if (sess) {
        const next: SwipeSession = { ...sess, analysis: j.analysis, chat: seeded };
        setSess(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        scheduleSave(next);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveBoard() {
    if (!sess) return;
    const likedPins = sess.entries.filter((e) => isPositive(e.choice)).map((e) => e.pin);
    if (likedPins.length === 0) {
      setError("Nothing liked — nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pinterest/boards/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBoardName || `${sess.sourceBoardName} — liked`,
          description: `Curated from ${sess.sourceBoardName} via designr`,
          pins: likedPins,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      setSaveResult({
        succeeded: j.succeeded,
        total: j.total,
        boardId: j.board.id,
        errorSamples: j.errorSamples,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(false);
    }
  }

  async function onChatFile(file: File | null) {
    if (!file) {
      setChatImage(null);
      return;
    }
    // Max ~4MB to keep request size sane.
    if (file.size > 4 * 1024 * 1024) {
      setError("Image is too large (max 4MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setChatImage(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setError("Failed to read image.");
    reader.readAsDataURL(file);
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text && !chatImage) return;
    const newTurn: ChatTurn = { role: "user", text: text || "(image)", imageDataUrl: chatImage ?? undefined };
    const next = [...chat, newTurn];
    setChat(next);
    setChatInput("");
    setChatImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setChatBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId || undefined, messages: next }),
      });
      const chatText = await res.text();
      let j: { reply: string; modelUsed?: string; error?: string };
      try { j = JSON.parse(chatText); } catch {
        throw new Error(res.ok ? "Invalid response from server" : `Server error (${res.status})`);
      }
      if (!res.ok) throw new Error(j.error || "Chat failed");
      const finalChat = [...next, { role: "assistant" as const, text: j.reply }];
      setChat(finalChat);
      if (sess) {
        const updated: SwipeSession = { ...sess, chat: finalChat };
        setSess(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        scheduleSave(updated);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed");
      // Roll back the user turn so they can retry.
      setChat((c) => c.slice(0, -1));
      setChatInput(text);
    } finally {
      setChatBusy(false);
    }
  }

  function downloadBlob(content: string, mime: string, ext: string) {
    if (!sess) return;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const slug = sess.sourceBoardName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `designr-${slug || "session"}-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // TSV cells must not contain literal tabs or newlines — replace them with
  // single spaces so Excel/Sheets keeps the row/column alignment.
  function tsvCell(v: string | null | undefined): string {
    if (v == null) return "";
    return String(v).replace(/[\t\r\n]+/g, " ").trim();
  }

  function exportTsv() {
    if (!sess) return;
    const headers = [
      "user",
      "user_name",
      "choice",
      "note",
      "pin_id",
      "pin_title",
      "pin_link",
      "image_url",
      "pin_description",
    ];
    const nameFor = (u: string | undefined) => {
      if (u === "A") return sess.userNames?.A ?? "A";
      if (u === "B") return sess.userNames?.B ?? "B";
      // Solo-mode entries have no userId — fall back to the solo user's name.
      return sess.userNames?.A ?? "";
    };
    const rows = sess.entries.map((e) =>
      [
        e.userId ?? "",
        nameFor(e.userId),
        e.choice,
        e.note ?? "",
        e.pin.id,
        e.pin.title ?? "",
        e.pin.link ?? "",
        e.pin.imageUrl,
        e.pin.description ?? "",
      ]
        .map(tsvCell)
        .join("\t")
    );
    const tsv = [headers.join("\t"), ...rows].join("\n") + "\n";
    downloadBlob(tsv, "text/tab-separated-values", "tsv");
  }

  function exportSession() {
    if (!sess) return;
    // Pinterest boards can't carry notes or per-pin metadata, so we export a
    // JSON blob with everything the user saw and said. Self-contained —
    // can be re-imported, archived, or fed back to any tool later.
    const payload = {
      exportedAt: new Date().toISOString(),
      sourceBoard: {
        id: sess.sourceBoardId,
        name: sess.sourceBoardName,
      },
      mode: sess.mode ?? "single",
      userNames: sess.userNames,
      analysis,
      chat: chat.length > 1 ? chat : undefined,
      entries: sess.entries.map((e) => ({
        userId: e.userId,
        choice: e.choice,
        note: e.note,
        pin: {
          id: e.pin.id,
          title: e.pin.title,
          description: e.pin.description,
          link: e.pin.link,
          imageUrl: e.pin.imageUrl,
        },
      })),
    };
    downloadBlob(JSON.stringify(payload, null, 2), "application/json", "json");
  }

  function startOver() {
    localStorage.removeItem(STORAGE_KEY);
    resetTheme();
    window.dispatchEvent(new Event("designr:theme"));
    router.push("/boards");
  }

  if (!sess) return <main className="container"><div className="notice"><span className="spinner" /></div></main>;

  // Group entries by pin id so that a pin both users reacted to renders as a
  // single card with their combined verdicts/notes stacked underneath.
  type Group = {
    pin: SwipeEntry["pin"];
    rows: Array<{ entry: SwipeEntry; idx: number }>;
    firstSeen: number; // original-order anchor = lowest entry idx in the group
    score: number;    // sum of choiceWeight across all rows (for sorting)
  };
  // Signed score: +3 superlike, +1 like, -1 dislike, -3 superdislike.
  // Summed across all rows in the group (i.e. across both users in dual mode).
  function signedScore(c: SwipeChoice): number {
    switch (c) {
      case "superlike": return 3;
      case "like": return 1;
      case "dislike": return -1;
      case "superdislike": return -3;
    }
  }
  const groups: Group[] = (() => {
    const map = new Map<string, Group>();
    sess.entries.forEach((e, i) => {
      const existing = map.get(e.pin.id);
      if (existing) {
        existing.rows.push({ entry: e, idx: i });
      } else {
        map.set(e.pin.id, {
          pin: e.pin,
          rows: [{ entry: e, idx: i }],
          firstSeen: i,
          score: 0,
        });
      }
    });
    for (const g of map.values()) {
      g.score = g.rows.reduce((acc, r) => acc + signedScore(r.entry.choice), 0);
    }
    return Array.from(map.values());
  })();
  const sortedGroups =
    sortMode === "score"
      ? [...groups].sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
      : [...groups].sort((a, b) => a.firstSeen - b.firstSeen);

  const positives = sess.entries.filter((e) => isPositive(e.choice));
  const superLikes = sess.entries.filter((e) => e.choice === "superlike");
  const likes = sess.entries.filter((e) => e.choice === "like");
  const dislikes = sess.entries.filter((e) => e.choice === "dislike");
  const superDislikes = sess.entries.filter((e) => e.choice === "superdislike");
  const ANALYSIS_CAP = 100;
  const willAnalyze = Math.min(sess.entries.length, ANALYSIS_CAP);

  return (
    <main className="container">
      <div className="toolbar">
        <h2>
          Review — {sess.sourceBoardName}{" "}
          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>
            · {superLikes.length}★ {likes.length}♥ {dislikes.length}✕ {superDislikes.length}⊘
          </span>
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn ghost" onClick={startOver}>Start over</button>
          <button className="btn ghost" onClick={exportSession} title="Download notes, choices, and analysis as JSON">
            Export JSON
          </button>
          <button className="btn ghost" onClick={exportTsv} title="Download entries as tab-separated values (spreadsheet-friendly)">
            Export TSV
          </button>
          <select
            className="model-select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            title="How to order the review cards"
          >
            <option value="original">Board order</option>
            <option value="score">Most liked first</option>
          </select>
          <select
            className="model-select"
            value={modelId}
            onChange={(e) => onModelChange(e.target.value)}
            title="Choose which AI model analyzes your style"
          >
            <option value="">{DEFAULT_MODEL_LABEL}</option>
            {freeModels === null && <option disabled>Loading free models…</option>}
            {freeModels && freeModels.length > 0 && (
              <optgroup label="Free (vision-capable)">
                {freeModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {Math.round(m.contextLength / 1000)}k ctx
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button className="btn" onClick={analyze} disabled={analyzing}>
            {analyzing ? (
              <><span className="spinner" /> Analyzing…</>
            ) : (
              <>
                Analyze my style
                {sess.entries.length > 0 && (
                  <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                    ({willAnalyze}
                    {sess.entries.length > ANALYSIS_CAP ? ` of ${sess.entries.length}` : ""})
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      {analysis && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px" }}>Your style, according to the AI</h3>
          <div className="analysis"><Markdown>{analysis}</Markdown></div>
          {analysisModel && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--muted, #a1a1aa)",
              }}
            >
              answered by: <code>{analysisModel}</code>
              {modelId && analysisModel !== modelId && (
                <> — fell back from <code>{modelId}</code></>
              )}
            </div>
          )}
        </div>
      )}

      {chat.length > 1 && (
        <div className="chat-log" style={{ marginBottom: 16 }}>
          {chat.slice(1).map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.imageDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="chat-attach" src={m.imageDataUrl} alt="" />
              )}
              <div className="chat-bubble"><Markdown>{m.text}</Markdown></div>
            </div>
          ))}
          {chatBusy && (
            <div className="chat-msg assistant">
              <div className="chat-bubble"><span className="spinner" /> thinking…</div>
            </div>
          )}
        </div>
      )}

      {analysis && (
        <div className="chat-composer" style={{ marginBottom: 24 }}>
          {chatImage && (
            <div className="chat-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={chatImage} alt="attachment" />
              <button
                className="btn ghost"
                onClick={() => {
                  setChatImage(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Remove
              </button>
            </div>
          )}
          <div className="chat-row">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Ask a follow-up… (⌘/Ctrl+Enter to send)"
              rows={2}
            />
            <div className="chat-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => onChatFile(e.target.files?.[0] ?? null)}
              />
              <button
                className="btn ghost"
                onClick={() => fileInputRef.current?.click()}
                title="Attach an image"
              >
                📎 Image
              </button>
              <button
                className="btn primary"
                onClick={sendChat}
                disabled={chatBusy || (!chatInput.trim() && !chatImage)}
              >
                {chatBusy ? <><span className="spinner" /> Sending…</> : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <input
          value={newBoardName}
          onChange={(e) => setNewBoardName(e.target.value)}
          placeholder="New board name"
          style={{
            flex: 1,
            minWidth: 220,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "10px 14px",
            color: "var(--text)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          className="btn primary"
          onClick={saveBoard}
          disabled={saving || positives.length === 0}
        >
          {saving ? <><span className="spinner" /> Saving…</> : `Save ${positives.length} likes as new Pinterest board`}
        </button>
        {saveResult && (
          <div style={{ width: "100%" }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Saved {saveResult.succeeded}/{saveResult.total} pins
              {saveResult.succeeded === saveResult.total ? " ✓" : ""}
            </div>
            {saveResult.errorSamples && saveResult.errorSamples.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                <summary style={{ cursor: "pointer" }}>
                  {saveResult.total - saveResult.succeeded} pin(s) failed — show error
                </summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    marginTop: 6,
                    color: "#fca5a5",
                  }}
                >
                  {saveResult.errorSamples.join("\n\n")}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="review-grid">
        {sortedGroups.map((g) => {
          // Dominant choice drives the card's border color — strongest signal
          // wins (abs(score) of any single row).
          const dominant = g.rows.reduce((best, r) =>
            Math.abs(signedScore(r.entry.choice)) >
            Math.abs(signedScore(best.entry.choice))
              ? r
              : best
          ).entry.choice;
          return (
            <div key={g.pin.id} className={`review-card ${dominant}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.pin.imageUrl} alt={g.pin.title ?? ""} />
              <div className="body">
                {g.rows.map(({ entry, idx }) => {
                  const who = entry.userId
                    ? sess.userNames?.[entry.userId] || entry.userId
                    : null;
                  return (
                    <div key={idx} className="review-row">
                      <div className="review-row-head">
                        {who && (
                          <span className={`user-chip user-${entry.userId?.toLowerCase()}`}>
                            {who}
                          </span>
                        )}
                        <span className="tag">{choiceLabel(entry.choice)}</span>
                      </div>
                      <textarea
                        value={entry.note ?? ""}
                        placeholder="Add a note…"
                        onChange={(ev) => updateEntry(idx, { note: ev.target.value })}
                      />
                      <div className="choice-row" role="radiogroup" aria-label="Change verdict">
                        {CHOICES.map((c) => (
                          <button
                            key={c}
                            className={`choice-btn ${c} ${entry.choice === c ? "active" : ""}`}
                            onClick={() => updateEntry(idx, { choice: c })}
                            title={choiceLabel(c).toLowerCase()}
                            aria-label={choiceLabel(c).toLowerCase()}
                            aria-pressed={entry.choice === c}
                          >
                            {CHOICE_GLYPH[c]}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
