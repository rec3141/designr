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

export type SwipeChoice = "like" | "dislike" | "superlike" | "superdislike";

export function isPositive(c: SwipeChoice): boolean {
  return c === "like" || c === "superlike";
}

export function choiceWeight(c: SwipeChoice): number {
  switch (c) {
    case "superlike": return 3;
    case "like": return 1;
    case "dislike": return 0;
    case "superdislike": return 0;
  }
}

export function choiceLabel(c: SwipeChoice): string {
  return c === "superlike" ? "SUPERLIKE"
    : c === "like" ? "LIKE"
    : c === "dislike" ? "DISLIKE"
    : "SUPERDISLIKE";
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
