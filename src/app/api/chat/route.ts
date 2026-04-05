import { NextRequest, NextResponse } from "next/server";
import {
  chatCompletion,
  FOLLOWUP_SYSTEM_PROMPT,
  type ChatMessage,
} from "@/lib/openrouter";

export const maxDuration = 60;

type InboundMessage = {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
};

type Body = {
  model?: string;
  messages: InboundMessage[];
};

function toChatMessage(m: InboundMessage): ChatMessage {
  if (!m.imageDataUrl) {
    return { role: m.role, content: m.text };
  }
  // OpenRouter passes image_url through to the underlying model. Data URLs
  // work for Claude and most vision models.
  return {
    role: m.role,
    content: [
      { type: "text", text: m.text || "(see attached image)" },
      { type: "image_url", image_url: { url: m.imageDataUrl } },
    ],
  };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
    ...body.messages.map(toChatMessage),
  ];

  try {
    const { content, modelUsed } = await chatCompletion(messages, body.model);
    return NextResponse.json({ reply: content, modelUsed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    console.error("[api/chat] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
