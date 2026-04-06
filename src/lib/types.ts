export type Pin = {
  id: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  imageUrl: string;
  boardId?: string | null;
};

export type Board = {
  id: string;
  name: string;
  description?: string | null;
  pinCount?: number;
  coverImageUrl?: string | null;
};

export type SwipeChoice = "like" | "dislike" | "superlike" | "superdislike" | "skip";

export function isPositive(c: SwipeChoice): boolean {
  return c === "like" || c === "superlike";
}

export function isNeutral(c: SwipeChoice): boolean {
  return c === "skip";
}

export function choiceWeight(c: SwipeChoice): number {
  switch (c) {
    case "superlike": return 3;
    case "like": return 1;
    case "skip": return 0;
    case "dislike": return 0;
    case "superdislike": return 0;
  }
}

export function choiceLabel(c: SwipeChoice): string {
  switch (c) {
    case "superlike": return "SUPERLIKE";
    case "like": return "LIKE";
    case "skip": return "SKIP";
    case "dislike": return "DISLIKE";
    case "superdislike": return "SUPERDISLIKE";
  }
}

export type UserId = "A" | "B";

export type SwipeEntry = {
  pin: Pin;
  choice: SwipeChoice;
  note?: string;
  // Present only in dual-user ("2P") sessions. Single-user entries leave this
  // undefined so downstream code that ignores it keeps working.
  userId?: UserId;
};

export type SwipeSession = {
  sourceBoardId: string;
  sourceBoardName: string;
  entries: SwipeEntry[];
  createdAt: number;
  mode?: "single" | "dual";
  userNames?: { A?: string; B?: string };
  // Progress tracking — set when finishing early so review page can
  // offer a "Continue swiping" button to return to the deck.
  currentIndex?: number;
  totalPins?: number;
  sectionId?: string;
  // Set once the session has been persisted to the backend. Lets the review
  // page update the existing row instead of creating duplicates on every
  // note/analysis change.
  savedId?: string;
  // Persisted across reloads so we can round-trip the conversation.
  analysis?: string;
  chat?: Array<{
    role: "user" | "assistant";
    text: string;
    imageDataUrl?: string;
  }>;
};
