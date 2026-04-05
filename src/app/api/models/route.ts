import { NextResponse } from "next/server";

// OpenRouter's model catalog. We filter to free multimodal (vision-capable)
// models so the user can opt into zero-cost style analysis.
type RawModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; image?: string };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

export async function GET() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
      next: { revalidate: 3600 }, // cache 1h
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `openrouter models api: ${res.status}` },
        { status: 502 }
      );
    }
    const json = (await res.json()) as { data: RawModel[] };

    const isFree = (m: RawModel) => {
      const p = m.pricing;
      if (!p) return false;
      return (
        (parseFloat(p.prompt ?? "0") || 0) === 0 &&
        (parseFloat(p.completion ?? "0") || 0) === 0 &&
        (parseFloat(p.image ?? "0") || 0) === 0
      );
    };

    // Must accept both text and image as input, and produce text as output.
    // (Filters out audio/music/image-generation models that happen to take
    // image input.)
    const isVisionChat = (m: RawModel) => {
      const a = m.architecture;
      if (!a) return false;
      const inputs = a.input_modalities ?? [];
      const outputs = a.output_modalities ?? [];
      const inModality = a.modality ?? "";
      const hasImageIn =
        inputs.includes("image") || inModality.includes("image");
      const hasTextIn =
        inputs.includes("text") || inModality.includes("text");
      const hasTextOut =
        outputs.length === 0
          ? inModality.includes("->text") || inModality.endsWith("text")
          : outputs.includes("text");
      const producesOnlyText =
        outputs.length === 0 ? true : outputs.every((o) => o === "text");
      return hasImageIn && hasTextIn && hasTextOut && producesOnlyText;
    };

    const models = json.data
      .filter((m) => isFree(m) && isVisionChat(m))
      .map((m) => ({
        id: m.id,
        name: m.name,
        contextLength: m.context_length ?? 0,
      }))
      // Biggest context first — more headroom for 100 images + labels.
      .sort((a, b) => b.contextLength - a.contextLength);

    return NextResponse.json({ models });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
