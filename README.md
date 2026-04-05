# designr

A Tinder-style swipe app for Pinterest boards. Sign in with Pinterest, pick a board, swipe like/dislike on every pin (with optional notes), then let a multimodal AI analyze your taste and save your likes as a brand-new Pinterest board.

The app's own aesthetic **evolves as you swipe** — it pulls colors from the pins you like and reshapes its palette to match your taste.

## Setup

### 1. Install

```bash
npm install
```

### 2. Register a Pinterest app

1. Go to https://developers.pinterest.com/apps/ and create a new app.
2. Under **Redirect URIs**, add **exactly**:
   ```
   http://localhost:3000/api/auth/callback
   ```
3. Under **Scopes**, enable:
   - `boards:read`
   - `pins:read`
   - `boards:write`
   - `pins:write`
   - `user_accounts:read`
4. Copy your **App ID** (client ID) and **App secret key** (client secret).

> Pinterest apps start in "trial" mode — you'll need to add your own Pinterest account as a test user in the app settings to authenticate.

### 3. Get an OpenRouter key

Sign up at https://openrouter.ai/ and grab an API key from https://openrouter.ai/keys.

### 4. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

```
PINTEREST_CLIENT_ID=your_pinterest_app_id
PINTEREST_CLIENT_SECRET=your_pinterest_app_secret
PINTEREST_REDIRECT_URI=http://localhost:3000/api/auth/callback
SESSION_SECRET=a_random_string_at_least_32_characters_long
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

`OPENROUTER_MODEL` can be any multimodal model listed on OpenRouter (e.g. `openai/gpt-4o`, `google/gemini-2.0-flash-exp:free`, etc.).

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000.

## Flow

1. **Land** → Continue with Pinterest (OAuth).
2. **Boards** → pick a board to swipe through.
3. **Swipe** → drag right to like, left to dislike, or use the buttons. Type a note on any card before deciding. The app's colors shift as you go.
4. **Review** → edit notes, flip any decision, run **Analyze my style** (multimodal AI reads your likes/dislikes/notes + images and writes a style summary), and **Save** your likes as a new Pinterest board.

## Architecture

- **Next.js 14 App Router + TypeScript**
- **iron-session** — encrypted cookie holds the Pinterest access token
- **framer-motion** — swipe gestures
- **Pinterest REST API v5** — boards, pins, OAuth
- **OpenRouter** — multimodal chat completions with image content parts
- Swipe session state lives in **localStorage** until the user saves or starts over — no database required.

## Files

```
src/
  app/
    page.tsx                           Landing
    boards/page.tsx                    Board picker
    swipe/[boardId]/page.tsx           Swipe UI
    review/page.tsx                    Review + analyze + save
    api/
      auth/pinterest/route.ts          Start OAuth
      auth/callback/route.ts           OAuth callback
      auth/logout/route.ts
      auth/me/route.ts
      pinterest/boards/route.ts        List boards
      pinterest/boards/[id]/pins/route.ts
      pinterest/boards/create/route.ts Create board + copy pins
      analyze/route.ts                 OpenRouter multimodal analysis
  components/
    SwipeCard.tsx
    ThemeTuner.tsx                     Dynamic theme from liked images
  lib/
    types.ts
    session.ts
    pinterest.ts
    openrouter.ts
```
