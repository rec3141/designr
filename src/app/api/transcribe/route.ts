import { NextRequest, NextResponse } from "next/server";

// OpenRouter's input_audio content block follows the OpenAI-compat spec which
// only accepts "wav" or "mp3" formats. The browser recorder (src/lib/voice.ts)
// emits 16kHz mono WAV base64, which any audio-capable model on OpenRouter
// will accept (Gemini 2.x, GPT-4o audio, etc.). We use Gemini by default
// because it's cheap, fast, and doesn't reject brief dictation clips.

const DEFAULT_AUDIO_MODEL = "google/gemini-2.5-flash";

type Body = {
  wavBase64: string;
  model?: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "missing_openrouter_key" }, { status: 500 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.wavBase64 || typeof body.wavBase64 !== "string") {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  const model = body.model?.trim() || process.env.OPENROUTER_AUDIO_MODEL || DEFAULT_AUDIO_MODEL;

  const messages = [
    {
      role: "system",
      content:
        "You are a transcription engine. Transcribe the user's speech verbatim. Return ONLY the transcription text — no quotes, no prefixes like 'Transcript:', no commentary. If the audio is silent or unintelligible, return an empty string.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Transcribe this audio." },
        {
          type: "input_audio",
          input_audio: { data: body.wavBase64, format: "wav" },
        },
      ],
    },
  ];

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "designr",
      },
      body: JSON.stringify({ model, messages, temperature: 0 }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[transcribe] openrouter error:", res.status, txt);
      return NextResponse.json(
        { error: `openrouter: ${res.status} ${txt.slice(0, 300)}` },
        { status: 502 }
      );
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    return NextResponse.json({ text });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    console.error("[transcribe] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const maxDuration = 30;
