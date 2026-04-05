# designr — Claude context

Tinder-style swipe app for Pinterest boards. Sign in with Pinterest OAuth → pick a board → swipe like/dislike on every pin with optional voice notes → AI (via OpenRouter) writes a style portrait → save liked pins back to a new Pinterest board.

## Run

```bash
npm run dev              # next dev on :3000 (3001 if taken)
npm run build && npm start
```

Env in `.env.local`: `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`, `PINTEREST_REDIRECT_URI`, `SESSION_SECRET`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `anthropic/claude-sonnet-4.6`).

## Deployment

Two artifacts, deployed separately:

- **`site/`** — static marketing landing (`index.html`, `privacy/`). Lives at Dreamhost webroot `~/designr.quest/` via `ssh designr` (host alias in `~/.ssh/config`). Push with `npm run deploy:site` (rsync with `--delete`, excludes `.dh-diag` symlink and `favicon.*` placeholders that Dreamhost owns).
- **Next.js app** — the actual swipe app. Lives at the same root domain; deployment pipeline TBD (not yet scripted).

Pinterest app is in **trial mode** by default — only allowlisted test users can sign in. To truly open it up, submit for review in the Pinterest developer console.

## Architecture

- **Next.js 14 App Router** + TypeScript
- **iron-session** — encrypted cookie stores Pinterest tokens + `userId`/`username` (fetched once in OAuth callback via `/v5/user_account`)
- **better-sqlite3** — tiny KV at `./data/designr.db` (git-ignored), keyed on Pinterest user id, for persisting swipe sessions + analysis + chat across devices. See `src/lib/db.ts`.
- **OpenRouter** — multimodal chat completions for analysis, follow-up chat, and voice transcription (Gemini 2.5 Flash for audio). `src/lib/openrouter.ts`.
- **framer-motion** `useDragControls` with `dragListener={false}` — drag only starts on the card image, leaving the note textarea free for text selection.
- **Theme system** (`src/lib/theme.ts`) — evolving palette sampled from liked pins, applied live to `:root` CSS vars via `ThemeTuner`. Ingestion happens on every positive swipe; stored in localStorage.

## Key files

```
src/
  app/
    page.tsx                            Next.js landing (not same as site/index.html)
    boards/page.tsx                     Board picker
    swipe/[boardId]/page.tsx            Swipe UI (solo + 2P, voice, re-pick)
    review/page.tsx                     Review + analyze + chat + export + save
    library/page.tsx                    Past saved sessions
    api/
      auth/pinterest|callback|me|logout Pinterest OAuth
      pinterest/boards/*                List boards, list pins, create+copy pins
      analyze                           OpenRouter analysis
      chat                              Follow-up chat with text + image
      transcribe                        Voice → text (OpenRouter audio)
      sessions                          KV persistence (GET list, POST upsert)
      sessions/[id]                     GET load, DELETE
      models                            Free vision-capable models catalog
      img                               Image proxy (CORS for canvas color sampling)
  components/
    SwipeCard.tsx                       Drag-to-decide card
    ThemeTuner.tsx                      Applies live palette from localStorage
  lib/
    types.ts                            Pin, Board, SwipeEntry, SwipeSession, UserId
    session.ts                          iron-session config (AppSession shape)
    pinterest.ts                        REST wrapper (boards, pins, user_account)
    openrouter.ts                       chatCompletion, analyzeStyle, prompts
    voice.ts                            Web Audio → 16kHz mono WAV base64
    theme.ts                            Dynamic palette ingestion + apply
    db.ts                               SQLite KV: list/get/upsert/delete sessions
site/
  index.html                            Static marketing page (Dreamhost)
  privacy/index.html
```

## Features built out

- **Dual-user "2P" mode** — both users react to each pin (A votes, then B, then advance). Turn indicator = highlighted name input. Left rail = A's picks, right rail = B's picks.
- **Voice dictation** — hold Shift to dictate a note. Min 400ms to filter accidental shift taps (Gemini hallucinates canned sentences from silence otherwise). Commit awaits any in-flight transcription before advancing.
- **Review card grouping** — one card per pin, with stacked rows per user verdict in 2P. Sort by board order or by total signed score (+3/+1/-1/-3).
- **Library backend** — sessions auto-save to SQLite on finish; analysis and chat debounce-save on change. `/library` lists past sessions per Pinterest user id.
- **Export** — JSON and TSV download from review page (Pinterest boards can't carry notes, so this is the only way to keep them).
- **Hex-chip rendering** — AI analysis text is split on `#RRGGBB` regex and rendered with inline color swatches.
- **Duplicate board name retry** — `/api/pinterest/boards/create` auto-appends " (2)", " (3)" up to 20 if Pinterest rejects with code 58.

## Conventions / gotchas

- `SwipeEntry.userId` is only set in 2P mode. Single-user entries leave it undefined — keep that contract when adding filters.
- Always read `currentNote` via `currentNoteRef.current` inside async commit flows — the React state closure is stale after awaiting transcription.
- Sessions saved with a pre-userId cookie will 401 on `/api/sessions` POST. Users who authenticated before the user-id-in-cookie change need to sign out and back in.
- The `data/` directory is git-ignored; don't commit the SQLite file.
- Theme updates paint live via `designr:theme` event — don't remove `ThemeTuner` from the root layout; ingestion happens in `src/app/swipe/[boardId]/page.tsx`'s `ingestThemeFor`.
- `site/index.html` and `src/app/page.tsx` are two different "landings". Marketing CTA → Pinterest OAuth lives in `site/index.html` and requires a Dreamhost push to go live.

## Commands cheat sheet

```bash
# Dev
npm run dev

# Deploy marketing site to Dreamhost (rsyncs site/ → designr:~/designr.quest/)
npm run deploy:site
```
