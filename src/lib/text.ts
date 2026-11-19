/** Text styling + canvas drawing shared by photo text layers and video titles. */
export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  stroke: string;
  strokeWidth: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  bg: string | null;
  bgPadding: number;
  bgRadius: number;
}

export const DEFAULT_TEXT: TextStyle = {
  text: "Your text",
  fontFamily: "Geist",
  fontSize: 96,
  fontWeight: 700,
  italic: false,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.15,
  letterSpacing: 0,
  stroke: "#000000",
  strokeWidth: 0,
  shadow: false,
  shadowColor: "#000000",
  shadowBlur: 12,
  bg: null,
  bgPadding: 24,
  bgRadius: 12,
};

export const FONT_FAMILIES = ["Geist", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS", "Impact", "Segoe UI", "Tahoma", "Palatino Linotype"];

const fontStack = (s: TextStyle) => {
  const fam = s.fontFamily === "Geist" ? "var(--font-geist-sans)" : `"${s.fontFamily}"`;
  return `${s.italic ? "italic " : ""}${s.fontWeight} ${s.fontSize}px ${fam}, "Geist", Arial, sans-serif`;
};

let resolvedGeist: string | null = null;
function font(s: TextStyle) {
  // Canvas cannot resolve CSS variables, so look up the generated Geist family name once.
  if (resolvedGeist === null && typeof document !== "undefined") {
    resolvedGeist = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim() || "sans-serif";
  }
  return fontStack(s).replace("var(--font-geist-sans)", resolvedGeist ?? "sans-serif");
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Returns the bounding size of the text block including background padding. */
export function measureText(s: TextStyle): { w: number; h: number } {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  const ctx = measureCtx;
  ctx.font = font(s);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  const lines = s.text.split("\n");
  const w = Math.max(1, ...lines.map((l) => ctx.measureText(l || " ").width));
  const h = lines.length * s.fontSize * s.lineHeight;
  const pad = s.bg ? s.bgPadding : 0;
  return { w: Math.ceil(w + pad * 2 + s.strokeWidth), h: Math.ceil(h + pad * 2 + s.strokeWidth) };
}

/**
 * Draws the text block centred on the origin. `reveal` (0..1) draws only the first
 * fraction of characters, used by the typewriter animation.
 */
export function drawText(ctx: CanvasRenderingContext2D, s: TextStyle, reveal = 1) {
  const { w, h } = measureText(s);
  const pad = s.bg ? s.bgPadding : 0;
  ctx.save();
  if (s.bg) {
    ctx.fillStyle = s.bg;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(s.bgRadius, h / 2));
    ctx.fill();
  }
  ctx.font = font(s);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = s.align;
  ctx.lineJoin = "round";
  const x = s.align === "left" ? -w / 2 + pad + s.strokeWidth / 2 : s.align === "right" ? w / 2 - pad - s.strokeWidth / 2 : 0;
  const lines = s.text.split("\n");
  const lh = s.fontSize * s.lineHeight;
  let budget = reveal >= 1 ? Infinity : Math.floor(s.text.length * Math.max(0, reveal));
  if (s.shadow) {
    ctx.shadowColor = s.shadowColor;
    ctx.shadowBlur = s.shadowBlur;
    ctx.shadowOffsetY = s.shadowBlur / 3;
  }
  lines.forEach((line, i) => {
    const shown = budget === Infinity ? line : line.slice(0, Math.max(0, budget));
    if (budget !== Infinity) budget -= line.length + 1;
    if (!shown) return;
    const y = -h / 2 + pad + s.strokeWidth / 2 + lh * (i + 0.5);
    if (s.strokeWidth > 0) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeText(shown, x, y);
    }
    ctx.fillStyle = s.color;
    ctx.fillText(shown, x, y);
  });
  ctx.restore();
}

/** Registers a user-supplied font file (ttf/otf/woff/woff2) for use on canvas. */
export async function registerFont(name: string, data: ArrayBuffer) {
  const face = new FontFace(name, data);
  await face.load();
  document.fonts.add(face);
}
