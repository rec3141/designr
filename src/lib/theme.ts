// Client-only dynamic theme: samples colors from liked pins and blends them
// into the CSS variables, so the app aesthetic evolves as the user swipes.

export type ThemeState = {
  count: number; // number of liked images ingested
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
};

const STORAGE_KEY = "designr_theme";

export function loadTheme(): ThemeState {
  if (typeof window === "undefined") return neutral();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return neutral();
    const t = JSON.parse(raw) as ThemeState;
    if (typeof t.h !== "number") return neutral();
    return t;
  } catch {
    return neutral();
  }
}

export function saveTheme(t: ThemeState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

export function resetTheme() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  applyTheme(neutral());
}

function neutral(): ThemeState {
  return { count: 0, h: 0, s: 0, l: 50 };
}

// Apply the current theme state to document root CSS variables.
// The "training strength" factor scales from 0→1 as more likes come in,
// causing the UI to drift further from the neutral dark base.
export function applyTheme(t: ThemeState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const strength = Math.min(1, t.count / 15); // fully trained at ~15 likes
  const bgSat = Math.round(t.s * 0.35 * strength);
  const panelSat = Math.round(t.s * 0.45 * strength);
  const accentSat = Math.max(40, Math.round(40 + t.s * 0.6 * strength));
  const accentLight = clamp(t.l, 45, 65);

  root.style.setProperty("--bg", `hsl(${t.h} ${bgSat}% ${6 + 2 * strength}%)`);
  root.style.setProperty("--panel", `hsl(${t.h} ${panelSat}% ${10 + 2 * strength}%)`);
  root.style.setProperty("--panel-2", `hsl(${t.h} ${panelSat}% ${14 + 2 * strength}%)`);
  root.style.setProperty("--border", `hsl(${t.h} ${panelSat}% ${20 + 3 * strength}%)`);
  if (t.count > 0) {
    root.style.setProperty("--accent", `hsl(${t.h} ${accentSat}% ${accentLight}%)`);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Sample the dominant color from an image URL.
// Downscales into an offscreen canvas and picks the vivid, mid-luma average,
// so flat backgrounds and extreme highlights don't dominate.
export async function sampleDominantHSL(imageUrl: string): Promise<{ h: number; s: number; l: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let sumH = 0, sumS = 0, sumL = 0, weight = 0;
        // Unit vector sum for hue (circular mean)
        let hx = 0, hy = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          const { h, s, l } = rgbToHsl(r, g, b);
          // Weight vivid, mid-luma pixels more.
          if (l < 10 || l > 92) continue;
          const w = s * 0.01 * (1 - Math.abs(l - 55) / 55);
          if (w <= 0) continue;
          const rad = (h * Math.PI) / 180;
          hx += Math.cos(rad) * w;
          hy += Math.sin(rad) * w;
          sumS += s * w;
          sumL += l * w;
          weight += w;
        }

        if (weight < 0.5) return resolve(null);
        let hue = (Math.atan2(hy, hx) * 180) / Math.PI;
        if (hue < 0) hue += 360;
        const sat = sumS / weight;
        const lig = sumL / weight;
        resolve({ h: hue, s: sat, l: lig });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = `/api/img?u=${encodeURIComponent(imageUrl)}`;
  });
}

// Blend a new sampled color into the running theme state (exponential moving
// average with circular mean for hue). `weight` lets a super-like push the
// palette harder than a regular like.
export function ingestColor(
  state: ThemeState,
  c: { h: number; s: number; l: number },
  weight = 1
): ThemeState {
  const count = state.count + 1;
  if (state.count === 0) {
    return { count, h: c.h, s: c.s, l: c.l };
  }
  // Circular mean for hue
  const w1 = state.count;
  const w2 = weight;
  const a1 = (state.h * Math.PI) / 180;
  const a2 = (c.h * Math.PI) / 180;
  const x = Math.cos(a1) * w1 + Math.cos(a2) * w2;
  const y = Math.sin(a1) * w1 + Math.sin(a2) * w2;
  let h = (Math.atan2(y, x) * 180) / Math.PI;
  if (h < 0) h += 360;
  const s = (state.s * w1 + c.s * w2) / (w1 + w2);
  const l = (state.l * w1 + c.l * w2) / (w1 + w2);
  return { count, h, s, l };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
