import type { Adjustments } from "@/lib/adjustments";
import { DEFAULT_ADJ } from "@/lib/adjustments";
import { autoColor, removeBackground, type ProgressFn } from "@/lib/ai/local";
import { getAdjustRenderer } from "@/lib/gl/adjust";
import type { MarketPreset } from "@/lib/presets";
import { makeCanvas } from "@/lib/utils";

export interface StudioBackground { id: string; name: string; paint: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null }

const grad = (stops: [number, string][], radial = false) => (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const g = radial ? ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.5, Math.max(w, h) * 0.75) : ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

/** Wall-and-floor backdrop: a soft horizon gives the product something to stand on. */
const sweep = (wall: string, floorTop: string, floorBottom: string) => (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  const y = h * 0.66;
  const g = ctx.createLinearGradient(0, y - h * 0.06, 0, h);
  g.addColorStop(0, wall);
  g.addColorStop(0.18, floorTop);
  g.addColorStop(1, floorBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, y - h * 0.06, w, h - y + h * 0.06);
};

export const STUDIO_BACKGROUNDS: StudioBackground[] = [
  { id: "white", name: "Pure white", paint: grad([[0, "#ffffff"], [1, "#ffffff"]]) },
  { id: "soft-grey", name: "Soft grey", paint: grad([[0, "#fbfbfc"], [1, "#d6d7dc"]], true) },
  { id: "warm", name: "Warm studio", paint: sweep("#f3ebe0", "#e9dccb", "#d9c7b0") },
  { id: "slate", name: "Dark slate", paint: grad([[0, "#565b67"], [1, "#16181d"]], true) },
  { id: "pastel", name: "Pastel", paint: grad([[0, "#dfeaf7"], [1, "#f6e9f1"]]) },
  { id: "sage", name: "Sage sweep", paint: sweep("#dfe6da", "#cfd9c8", "#b9c7b0") },
  { id: "transparent", name: "Transparent", paint: null },
];

export interface StudioSettings {
  /** "preset" uses the marketplace's own background; "custom" uses `color`; otherwise a STUDIO_BACKGROUNDS id. */
  background: string;
  color: string;
  /** Overrides the preset's fill fraction (0..1) when set. */
  fill: number | null;
  offsetY: number;
  shadow: "none" | "drop" | "contact";
  shadowStrength: number;
  enhance: boolean;
}

export const DEFAULT_STUDIO: StudioSettings = { background: "preset", color: "#f2f2f2", fill: null, offsetY: 0, shadow: "contact", shadowStrength: 0.45, enhance: false };

export interface Cutout {
  /** Product pixels with transparent background, trimmed to the product's bounding box. */
  canvas: HTMLCanvasElement;
  /** Tone-only correction derived from the product pixels (no colour shifts). */
  enhance: Partial<Adjustments>;
}

/** Bounding box of pixels with meaningful alpha, measured on a downscaled copy for speed. */
function alphaBounds(c: HTMLCanvasElement) {
  const k = Math.min(1, 768 / Math.max(c.width, c.height));
  const s = makeCanvas(c.width * k, c.height * k);
  const ctx = s.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, s.width, s.height);
  const d = ctx.getImageData(0, 0, s.width, s.height).data;
  let x0 = s.width, y0 = s.height, x1 = -1, y1 = -1;
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++)
      if (d[(y * s.width + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 2;
  const X0 = Math.max(0, Math.floor((x0 - pad) / k)), Y0 = Math.max(0, Math.floor((y0 - pad) / k));
  const X1 = Math.min(c.width, Math.ceil((x1 + 1 + pad) / k)), Y1 = Math.min(c.height, Math.ceil((y1 + 1 + pad) / k));
  return { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
}

/**
 * Clears islands the matte kept away from the product (bits of background texture), so a clean
 * backdrop stays clean and the trim box hugs the product. The largest region always stays; other
 * regions stay unless they are tiny next to it or only faintly opaque, so the separate pieces of a
 * multi-part product survive. Regions are labelled on a copy capped at 768 px for speed.
 */
function despeckle(c: HTMLCanvasElement) {
  const k = Math.min(1, 768 / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const small = makeCanvas(w, h);
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = "high"; // area-style downscale keeps thin parts connected
  sctx.drawImage(c, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  const size = [0], peak = [0];
  for (let i = 0; i < n; i++) {
    if (label[i] || d[i * 4 + 3] <= 8) continue;
    const id = size.length;
    let sp = 0, count = 0, top = 0;
    label[i] = id;
    stack[sp++] = i;
    while (sp) {
      const p = stack[--sp];
      count++;
      if (d[p * 4 + 3] > top) top = d[p * 4 + 3];
      const x = p % w, y = (p - x) / w;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const q = yy * w + xx;
          if (!label[q] && d[q * 4 + 3] > 8) {
            label[q] = id;
            stack[sp++] = q;
          }
        }
    }
    size.push(count);
    peak.push(top);
  }
  if (size.length <= 2) return; // one region or none: nothing to clean
  let main = 1;
  for (let id = 2; id < size.length; id++) if (size[id] > size[main]) main = id;
  const drop = size.map((count, id) => id > 0 && id !== main && (count < size[main] * 0.005 || peak[id] < 64));
  if (!drop.includes(true)) return;
  // Reuse the small image as an erase mask: opaque exactly where a dropped region is.
  for (let i = 0; i < n; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
    d[i * 4 + 3] = drop[label[i]] ? 255 : 0;
  }
  sctx.putImageData(img, 0, 0);
  const ctx = c.getContext("2d")!;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.imageSmoothingEnabled = false; // hard edges: never bleed into the regions that stay
  ctx.drawImage(small, 0, 0, c.width, c.height);
  ctx.restore();
}

/**
 * Cuts the product out of its photo. Only the alpha channel changes: the product's own
 * pixels (shape, artwork, colours) are copied through untouched.
 */
export async function cutOutProduct(file: Blob, onProgress?: ProgressFn): Promise<Cutout> {
  const matte = await removeBackground(file, onProgress);
  const bmp = await createImageBitmap(file);
  const full = makeCanvas(bmp.width, bmp.height);
  const ctx = full.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(matte, 0, 0, full.width, full.height);
  ctx.globalCompositeOperation = "source-over";
  despeckle(full);
  const b = alphaBounds(full);
  if (!b) throw new Error("No product could be found in this photo.");
  const canvas = makeCanvas(b.w, b.h);
  canvas.getContext("2d")!.drawImage(full, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  const { blacks, whites, gamma } = autoColor(canvas);
  return { canvas, enhance: { blacks, whites, gamma } };
}

/** Places a cut-out on the chosen backdrop at the marketplace's size and fill, with an optional shadow. */
export function composeProduct(cut: Cutout, preset: MarketPreset, s: StudioSettings, scale = 1): HTMLCanvasElement {
  const W = Math.round(preset.width * scale), H = Math.round(preset.height * scale);
  const out = makeCanvas(W, H);
  const ctx = out.getContext("2d")!;
  if (s.background === "preset") {
    if (preset.background !== "transparent") {
      ctx.fillStyle = preset.background;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (s.background === "custom") {
    ctx.fillStyle = s.color;
    ctx.fillRect(0, 0, W, H);
  } else STUDIO_BACKGROUNDS.find((b) => b.id === s.background)?.paint?.(ctx, W, H);

  let src: CanvasImageSource = cut.canvas;
  if (s.enhance) {
    const gl = getAdjustRenderer();
    const k = Math.min(1, (Math.max(W, H) * 1.2) / Math.max(cut.canvas.width, cut.canvas.height));
    const g = gl.render(cut.canvas, Math.round(cut.canvas.width * k), Math.round(cut.canvas.height * k), { ...DEFAULT_ADJ, ...cut.enhance }, { stream: true });
    const copy = makeCanvas(g.width, g.height);
    copy.getContext("2d")!.drawImage(g, 0, 0);
    src = copy;
  }
  const fill = s.fill ?? preset.fill;
  const k = Math.min((W * fill) / cut.canvas.width, (H * fill) / cut.canvas.height);
  const dw = cut.canvas.width * k, dh = cut.canvas.height * k;
  const dx = (W - dw) / 2, dy = (H - dh) / 2 + s.offsetY * H;
  ctx.imageSmoothingQuality = "high";
  if (s.shadow === "contact") {
    // A flattened ellipse under the base reads as the product resting on a surface.
    const cx = W / 2, cy = dy + dh - dh * 0.012, rx = dw * 0.46, ry = Math.max(dh * 0.035, H * 0.012);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${0.75 * s.shadowStrength})`);
    g.addColorStop(0.6, `rgba(0,0,0,${0.3 * s.shadowStrength})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (s.shadow === "drop") {
    ctx.shadowColor = `rgba(0,0,0,${0.6 * s.shadowStrength})`;
    ctx.shadowBlur = Math.max(W, H) * 0.035;
    ctx.shadowOffsetY = Math.max(W, H) * 0.018;
  }
  ctx.drawImage(src, dx, dy, dw, dh);
  return out;
}
