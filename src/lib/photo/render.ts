import { DEFAULT_ADJ, isDefaultAdj } from "@/lib/adjustments";
import { getBitmap, getImage } from "@/lib/assets";
import { getAdjustRenderer } from "@/lib/gl/adjust";
import { drawText } from "@/lib/text";
import { makeCanvas } from "@/lib/utils";
import type { ImageLayer, Layer, PhotoDoc, ShapeLayer } from "./types";

export interface RenderOpts {
  /** Use capped preview bitmaps (interactive) instead of full resolution (export). */
  preview: boolean;
  /** Before/after: skip adjustments and filters. */
  bypassAdjust?: boolean;
  /** Device pixels per document pixel; needed because canvas shadows ignore transforms. */
  scale: number;
}

const processed = new Map<string, { sig: string; canvas: HTMLCanvasElement }>();
let grainSeed = 1;

/** Returns the pixels for an image layer with adjustments, look and mask applied. */
function layerPixels(l: ImageLayer, o: RenderOpts): CanvasImageSource | null {
  const asset = getImage(l.assetId);
  if (!asset) return null;
  const src = o.preview ? asset.preview : asset.full;
  const adjust = !o.bypassAdjust && (!isDefaultAdj(l.adjustments) || !!l.filter.id);
  const mask = l.maskId ? getBitmap(l.maskId) : null;
  if (!adjust && !mask) return src;
  const sig = `${l.assetId}|${o.preview}|${adjust ? JSON.stringify(l.adjustments) + l.filter.id + l.filter.intensity : ""}|${l.maskId}`;
  const key = o.preview ? l.id : `${l.id}:full`;
  const hit = processed.get(key);
  if (hit && hit.sig === sig) return hit.canvas;
  const canvas = hit?.canvas ?? makeCanvas(src.width, src.height);
  if (canvas.width !== src.width || canvas.height !== src.height) {
    canvas.width = src.width;
    canvas.height = src.height;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "copy";
  if (adjust) {
    const out = getAdjustRenderer().render(src, src.width, src.height, l.adjustments, { filter: l.filter, seed: grainSeed });
    ctx.drawImage(out, 0, 0, canvas.width, canvas.height);
  } else ctx.drawImage(src, 0, 0);
  if (mask) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalCompositeOperation = "source-over";
  if (o.preview) processed.set(key, { sig, canvas });
  return canvas;
}

export function forgetLayer(id: string) {
  processed.delete(id);
}

function shapePath(ctx: CanvasRenderingContext2D, l: ShapeLayer) {
  const { w, h } = l;
  ctx.beginPath();
  switch (l.shape) {
    case "rect":
    case "line":
      ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(l.radius, w / 2, h / 2));
      break;
    case "ellipse":
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "triangle":
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      break;
    case "star":
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.42 : 1;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * (w / 2) * r, Math.sin(a) * (h / 2) * r);
      }
      ctx.closePath();
      break;
  }
}

function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, o: RenderOpts) {
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.globalCompositeOperation = l.blend;
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
  if (l.type === "image") {
    const px = layerPixels(l, o);
    if (px) {
      if (l.shadow.enabled) {
        const a = Math.round(l.shadow.opacity * 255).toString(16).padStart(2, "0");
        ctx.shadowColor = l.shadow.color + a;
        ctx.shadowBlur = l.shadow.blur * o.scale;
        ctx.shadowOffsetY = l.shadow.offsetY * o.scale;
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(px, -l.w / 2, -l.h / 2, l.w, l.h);
    }
  } else if (l.type === "paint") {
    const bmp = getBitmap(l.bitmapId);
    if (bmp) ctx.drawImage(bmp, -l.w / 2, -l.h / 2, l.w, l.h);
  } else if (l.type === "text") {
    drawText(ctx, l.style);
  } else {
    shapePath(ctx, l);
    ctx.fillStyle = l.fill;
    ctx.fill();
    if (l.strokeWidth > 0) {
      ctx.strokeStyle = l.stroke;
      ctx.lineWidth = l.strokeWidth;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draws the document in document coordinates; the caller sets the view transform. */
export function renderDoc(ctx: CanvasRenderingContext2D, doc: PhotoDoc, o: RenderOpts) {
  if (doc.background !== "transparent") {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  for (const l of doc.layers) if (l.visible) drawLayer(ctx, l, o);
}

/** Full-resolution flatten used by export, thumbnails and AI tools. */
export function flattenDoc(doc: PhotoDoc, scale = 1, preview = false): HTMLCanvasElement {
  const c = makeCanvas(doc.width * scale, doc.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(c.width / doc.width, c.height / doc.height);
  grainSeed = 1;
  renderDoc(ctx, doc, { preview, scale: c.width / doc.width });
  return c;
}

export const hasEdits = (l: ImageLayer) => !isDefaultAdj(l.adjustments) || !!l.filter.id;
export { DEFAULT_ADJ };
