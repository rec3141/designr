"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import SwipeCard from "@/components/SwipeCard";
import type { Pin, SwipeChoice, SwipeEntry, SwipeSession, UserId } from "@/lib/types";
import { choiceWeight, isPositive } from "@/lib/types";
import {
  applyTheme,
  ingestColor,
  loadTheme,
  sampleDominantHSL,
  saveTheme,
} from "@/lib/theme";
import { startRecording, type Recorder } from "@/lib/voice";

const STORAGE_KEY = "designr_swipe_session";
type Mode = "single" | "dual";

export default function SwipePage() {
  const params = useParams<{ boardId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const boardId = params.boardId;
  const boardName = search.get("name") || "Board";

  const [pins, setPins] = useState<Pin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<SwipeEntry[]>([]);
  const [currentNote, setCurrentNote] = useState("");
  // When non-null, the user clicked a past thumbnail and is re-picking that
  // entry. The number is an index into `entries`. Committing updates that
  // entry in place and returns the user to the live deck.
  const [reviewingIdx, setReviewingIdx] = useState<number | null>(null);
  // Dual-user ("2P") mode: both users take turns reacting to each pin.
  // `mode` is locked in once the first entry is recorded.
  const [mode, setMode] = useState<Mode>("single");
  const [currentUser, setCurrentUser] = useState<UserId>("A");
  const [userNames, setUserNames] = useState<{ A: string; B: string }>({ A: "", B: "" });
  // Voice dictation state. `recordingFor` tracks whose mic is hot OR whose
  // transcription is in flight, so the UI keeps showing the rec-dot until the
  // text actually lands. `recorderRef` holds the live recorder between
  // keydown/keyup; `pendingTranscriptionRef` holds any in-flight transcription
  // so commit() can await it before recording the decision.
  const [recordingFor, setRecordingFor] = useState<UserId | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const recStartRef = useRef<number>(0);
  const pendingTranscriptionRef = useRef<Promise<string> | null>(null);
  // Mirror of currentNote for reading the latest value inside async flows
  // (closures captured before awaits have stale state).
  const currentNoteRef = useRef("");

  useEffect(() => {
    currentNoteRef.current = currentNote;
  }, [currentNote]);

  useEffect(() => {
    fetch(`/api/pinterest/boards/${boardId}/pins`)
      .then(async (r) => {
        if (r.status === 401) {
          router.replace("/");
          return null;
        }
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const body = await r.text();
          throw new Error(
            `Server returned ${r.status} (non-JSON). Try refreshing the page.` +
              (body.slice(0, 120) ? ` [${body.slice(0, 120).replace(/\s+/g, " ")}…]` : "")
          );
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load pins");
        return j.pins as Pin[];
      })
      .then((p) => p && setPins(p))
      .catch((e) => setError(e.message));
  }, [boardId, router]);

  const liveCurrent = pins?.[index];
  const liveNext = pins?.[index + 1];
  const isReviewing = reviewingIdx !== null;
  const current = isReviewing ? entries[reviewingIdx!].pin : liveCurrent;
  const nextCard = isReviewing ? liveCurrent : liveNext;
  const done = !isReviewing && pins !== null && index >= pins.length;

  function ingestThemeFor(pin: Pin, choice: SwipeChoice) {
    if (!isPositive(choice)) return;
    const weight = choiceWeight(choice);
    sampleDominantHSL(pin.imageUrl).then((c) => {
      if (!c) return;
      const n = ingestColor(loadTheme(), c, weight);
      saveTheme(n);
      applyTheme(n);
      window.dispatchEvent(new Event("designr:theme"));
    });
  }

  async function commit(choice: SwipeChoice) {
    if (!current) return;
    // If dictation is still in flight (mic hot OR transcription pending),
    // wait for it to land so the text belongs to THIS pin, not the next one.
    if (recorderRef.current) {
      await stopVoiceAndTranscribe();
    } else if (pendingTranscriptionRef.current) {
      try {
        await pendingTranscriptionRef.current;
      } catch {
        /* error already surfaced via setError */
      }
    }
    const pin = current;

    if (isReviewing) {
      const idx = reviewingIdx!;
      const prev = entries[idx];
      setEntries((arr) =>
        arr.map((e, i) =>
          i === idx
            ? { ...e, choice, note: currentNote.trim() || e.note }
            : e
        )
      );
      setCurrentNote("");
      setReviewingIdx(null);
      // Only push the theme if they upgraded to a positive choice (we don't
      // try to un-ingest past contributions).
      if (isPositive(choice) && !isPositive(prev.choice)) {
        ingestThemeFor(pin, choice);
      } else if (isPositive(choice) && isPositive(prev.choice) && choice !== prev.choice) {
        // like → superlike: add the incremental weight
        const delta = choiceWeight(choice) - choiceWeight(prev.choice);
        if (delta > 0) {
          sampleDominantHSL(pin.imageUrl).then((c) => {
            if (!c) return;
            const n = ingestColor(loadTheme(), c, delta);
            saveTheme(n);
            applyTheme(n);
            window.dispatchEvent(new Event("designr:theme"));
          });
        }
      }
      return;
    }

    // Read the latest note via the ref — the closure's `currentNote` is stale
    // after awaiting a transcription.
    const finalNote = currentNoteRef.current.trim();
    const newEntry: SwipeEntry = {
      pin,
      choice,
      note: finalNote || undefined,
      userId: mode === "dual" ? currentUser : undefined,
    };
    setEntries((prev) => [...prev, newEntry]);
    setCurrentNote("");
    ingestThemeFor(pin, choice);

    // In dual mode A votes first, then B votes on the same pin, then we
    // advance. In single mode we always advance.
    if (mode === "dual" && currentUser === "A") {
      setCurrentUser("B");
    } else {
      setIndex((i) => i + 1);
      if (mode === "dual") setCurrentUser("A");
    }
  }

  function skip() {
    if (isReviewing) {
      cancelReview();
      return;
    }
    if (!liveCurrent) return;
    setCurrentNote("");
    // Skip only advances the current turn — in dual mode the partner still
    // gets a chance on this pin.
    if (mode === "dual" && currentUser === "A") {
      setCurrentUser("B");
    } else {
      setIndex((i) => i + 1);
      if (mode === "dual") setCurrentUser("A");
    }
  }

  // Anything shorter than this is almost certainly an accidental shift tap
  // (e.g. capitalizing a letter in the name field). We silently drop those —
  // otherwise audio models love to hallucinate canned sentences from silence.
  const MIN_RECORDING_MS = 400;

  async function startVoice(forUser: UserId) {
    if (recorderRef.current) return; // already recording
    try {
      const rec = await startRecording();
      recorderRef.current = rec;
      recStartRef.current = Date.now();
      setRecordingFor(forUser);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "microphone unavailable");
    }
  }

  async function stopVoiceAndTranscribe(): Promise<string> {
    const rec = recorderRef.current;
    if (!rec) return "";
    const elapsed = Date.now() - recStartRef.current;
    recorderRef.current = null;
    // Too short to be real speech — discard without hitting the API.
    if (elapsed < MIN_RECORDING_MS) {
      rec.cancel();
      setRecordingFor(null);
      return "";
    }
    // Keep `recordingFor` set — it now means "voice work in progress" until
    // the transcription actually lands in the note.
    let p!: Promise<string>;
    p = (async (): Promise<string> => {
      try {
        const wavBase64 = await rec.stop();
        if (!wavBase64) return "";
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wavBase64 }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "transcribe failed");
        const text = (j.text ?? "").trim();
        if (text) {
          setCurrentNote((n) => (n ? `${n} ${text}` : text));
        }
        return text;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "transcribe failed");
        return "";
      } finally {
        setRecordingFor(null);
        if (pendingTranscriptionRef.current === p) {
          pendingTranscriptionRef.current = null;
        }
      }
    })();
    pendingTranscriptionRef.current = p;
    return p;
  }

  function goBackTo(entryIdx: number) {
    if (entryIdx < 0 || entryIdx >= entries.length) return;
    setCurrentNote(entries[entryIdx].note ?? "");
    setReviewingIdx(entryIdx);
  }

  function cancelReview() {
    setReviewingIdx(null);
    setCurrentNote("");
  }

  function buildSession(): SwipeSession {
    return {
      sourceBoardId: boardId,
      sourceBoardName: boardName,
      entries,
      createdAt: Date.now(),
      mode,
      userNames:
        userNames.A || userNames.B
          ? {
              A: userNames.A || undefined,
              B: mode === "dual" ? userNames.B || undefined : undefined,
            }
          : undefined,
    };
  }

  async function persistSessionRemote(sess: SwipeSession): Promise<string | undefined> {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

  async function finishEarly() {
    if (!pins) return;
    if (entries.length === 0) {
      router.replace("/boards");
      return;
    }
    const sess = buildSession();
    // Persist to backend first (best-effort) so we can stash the id locally.
    // A failed save is non-fatal — localStorage is still the source of truth
    // for the immediate review step.
    const savedId = await persistSessionRemote(sess);
    if (savedId) sess.savedId = savedId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
    router.replace("/review");
  }

  // Keyboard shortcuts: ←/→ like/dislike, ↑/↓ super, space skip, Esc finish,
  // L-Shift/R-Shift push-to-talk for user A/B respectively. Shift handling
  // works even when the note textarea has focus; all other shortcuts are
  // suppressed while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Shift") {
        // Either shift key works — turn-based input already knows whose turn
        // it is, so we just dictate for the active user.
        if (e.repeat) return;
        let forUser: UserId = currentUser;
        if (isReviewing && mode === "dual") {
          // During re-pick, dictate for the entry's owner.
          const owner = entries[reviewingIdx!]?.userId;
          if (owner) forUser = owner;
        }
        e.preventDefault();
        startVoice(forUser);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (isReviewing) cancelReview();
        else finishEarly();
        return;
      }
      if (!current) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        skip();
        return;
      }
      let choice: SwipeChoice | null = null;
      switch (e.key) {
        case "ArrowLeft": choice = "dislike"; break;
        case "ArrowRight": choice = "like"; break;
        case "ArrowUp": choice = "superlike"; break;
        case "ArrowDown": choice = "superdislike"; break;
      }
      if (choice) {
        e.preventDefault();
        commit(choice);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Shift" && recorderRef.current) {
        e.preventDefault();
        stopVoiceAndTranscribe();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, currentNote, entries, pins, isReviewing, reviewingIdx, mode, currentUser]);

  useEffect(() => {
    if (done && pins) {
      const sess = buildSession();
      // Persist to backend in the background; stash the id locally once back.
      persistSessionRemote(sess).then((savedId) => {
        if (savedId) {
          sess.savedId = savedId;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
        }
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
      router.replace("/review");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, pins]);

  const progressLabel = useMemo(() => {
    if (!pins) return "";
    return `${Math.min(index + 1, pins.length)} / ${pins.length}`;
  }, [index, pins]);

  // Thumbnail rails — most-recent-first on each side.
  // Solo mode: left = dislikes, right = likes.
  // Dual mode: left = User A's picks, right = User B's picks (color-coded by
  // choice via border, so you still see likes vs dislikes at a glance).
  const leftRail = useMemo(() => {
    const indexed = entries.map((e, i) => ({ e, i }));
    const filtered =
      mode === "dual"
        ? indexed.filter((x) => x.e.userId === "A")
        : indexed.filter((x) => x.e.choice === "dislike" || x.e.choice === "superdislike");
    return filtered.reverse();
  }, [entries, mode]);
  const rightRail = useMemo(() => {
    const indexed = entries.map((e, i) => ({ e, i }));
    const filtered =
      mode === "dual"
        ? indexed.filter((x) => x.e.userId === "B")
        : indexed.filter((x) => x.e.choice === "like" || x.e.choice === "superlike");
    return filtered.reverse();
  }, [entries, mode]);

  const canChangeMode = entries.length === 0;
  // In dual mode the "active" user is whoever owns the current decision —
  // that's the entry being re-picked (if any), otherwise the live turn.
  const activeUser: UserId =
    isReviewing && entries[reviewingIdx!]?.userId
      ? (entries[reviewingIdx!].userId as UserId)
      : currentUser;

  return (
    <main className="swipe-stage">
      <div className="swipe-progress">
        <span>{boardName} · {progressLabel}</span>
        <div className="mode-toggle" role="group" aria-label="Session mode">
          <button
            className={`mode-btn ${mode === "single" ? "active" : ""}`}
            onClick={() => canChangeMode && setMode("single")}
            disabled={!canChangeMode}
            title={canChangeMode ? "Swipe solo" : "Locked after first swipe"}
          >
            Solo
          </button>
          <button
            className={`mode-btn ${mode === "dual" ? "active" : ""}`}
            onClick={() => canChangeMode && setMode("dual")}
            disabled={!canChangeMode}
            title={canChangeMode ? "Swipe together — both users take turns" : "Locked after first swipe"}
          >
            2P
          </button>
        </div>
        <div className="name-inputs" aria-label={mode === "dual" ? "Player names" : "Your name"}>
          <div className={`name-slot user-a ${mode === "single" || activeUser === "A" ? "active" : ""}`}>
            <input
              className="name-input user-a"
              value={userNames.A}
              onChange={(e) => setUserNames((n) => ({ ...n, A: e.target.value }))}
              placeholder={mode === "dual" ? "User A" : "Your name"}
              maxLength={24}
              aria-label={mode === "dual" ? "User A name" : "Your name"}
            />
            {recordingFor === "A" && <span className="rec-dot" />}
          </div>
          {mode === "dual" && (
            <div className={`name-slot user-b ${activeUser === "B" ? "active" : ""}`}>
              <input
                className="name-input user-b"
                value={userNames.B}
                onChange={(e) => setUserNames((n) => ({ ...n, B: e.target.value }))}
                placeholder="User B"
                maxLength={24}
                aria-label="User B name"
              />
              {recordingFor === "B" && <span className="rec-dot" />}
            </div>
          )}
        </div>
        <div className="dictation-hint">
          hold <kbd>⇧</kbd> to dictate a note
          {mode === "dual" && <> for the active player</>}
        </div>
        {isReviewing && (
          <span className="review-pill">
            Re-picking · <button className="link-btn" onClick={cancelReview}>cancel (Esc)</button>
          </span>
        )}
        {pins && current && !isReviewing && (
          <button
            className="btn ghost finish-btn"
            onClick={finishEarly}
            title="Finish early and review (Esc)"
          >
            Finish ({entries.length})
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {!pins && !error && <div className="notice"><span className="spinner" /> Loading pins…</div>}
      {pins && pins.length === 0 && <div className="notice">No pins in this board.</div>}
      {current && (
        <>
          <div className="swipe-layout">
            <Rail
              side="left"
              label={mode === "dual" ? userNames.A || "User A" : "Disliked"}
              items={leftRail}
              onPick={goBackTo}
              activeIdx={reviewingIdx}
              showLabel={mode === "dual"}
            />

            <div className="swipe-center">
              <div className="swipe-deck">
                {nextCard && (
                  <SwipeCard
                    key={nextCard.id + "_bg"}
                    pin={nextCard}
                    note=""
                    onNoteChange={() => {}}
                    onDecide={() => {}}
                    isTop={false}
                    zIndex={1}
                  />
                )}
                <SwipeCard
                  key={current.id + (isReviewing ? `_r${reviewingIdx}` : "")}
                  pin={current}
                  note={currentNote}
                  onNoteChange={setCurrentNote}
                  onDecide={commit}
                  isTop
                  zIndex={2}
                />
              </div>
              <div className="swipe-actions">
                <button
                  className="circle-btn superdislike"
                  onClick={() => commit("superdislike")}
                  aria-label="Super dislike"
                  title="Super dislike (↓)"
                >
                  ⊘
                </button>
                <button
                  className="circle-btn dislike"
                  onClick={() => commit("dislike")}
                  aria-label="Dislike"
                  title="Dislike (←)"
                >
                  ✕
                </button>
                <button
                  className="circle-btn skip"
                  onClick={skip}
                  aria-label="Skip"
                  title="Skip (space)"
                  disabled={isReviewing}
                >
                  »
                </button>
                <button
                  className="circle-btn like"
                  onClick={() => commit("like")}
                  aria-label="Like"
                  title="Like (→)"
                >
                  ♥
                </button>
                <button
                  className="circle-btn superlike"
                  onClick={() => commit("superlike")}
                  aria-label="Super like"
                  title="Super like (↑)"
                >
                  ★
                </button>
              </div>
              <div className="shortcut-hint">
                <kbd>↓</kbd> super dislike <span>·</span>{" "}
                <kbd>←</kbd> dislike <span>·</span>{" "}
                <kbd>space</kbd> skip <span>·</span>{" "}
                <kbd>→</kbd> like <span>·</span>{" "}
                <kbd>↑</kbd> super like <span>·</span>{" "}
                <kbd>Esc</kbd> {isReviewing ? "cancel" : "finish"}
              </div>
            </div>

            <Rail
              side="right"
              label={mode === "dual" ? userNames.B || "User B" : "Liked"}
              items={rightRail}
              onPick={goBackTo}
              activeIdx={reviewingIdx}
              showLabel={mode === "dual"}
            />
          </div>
        </>
      )}
    </main>
  );
}

function Rail({
  side,
  label,
  items,
  onPick,
  activeIdx,
  showLabel,
}: {
  side: "left" | "right";
  label: string;
  items: Array<{ e: SwipeEntry; i: number }>;
  onPick: (entryIdx: number) => void;
  activeIdx: number | null;
  showLabel: boolean;
}) {
  // In dual mode the rail represents a single user — match its tint to the
  // user's badge color for quick visual ownership.
  const ownerClass = showLabel ? (side === "left" ? "owner-a" : "owner-b") : "";
  return (
    <div className={`swipe-rail ${side} ${ownerClass}`} aria-label={label}>
      {showLabel && <div className="rail-label">{label}</div>}
      {items.map(({ e, i }) => (
        <button
          key={e.pin.id + "_" + i}
          className={`swipe-thumb ${e.choice}${activeIdx === i ? " active" : ""}`}
          style={{ backgroundImage: `url(${e.pin.imageUrl})` }}
          onClick={() => onPick(i)}
          title={`Re-pick: ${e.pin.title ?? e.choice}`}
          aria-label={`Re-pick pin marked ${e.choice}`}
        />
      ))}
    </div>
  );
}
