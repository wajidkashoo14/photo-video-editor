import { DEFAULT_ADJ, NO_FILTER, type Adjustments, type FilterRef } from "@/lib/adjustments";
import { DEFAULT_TEXT, measureText, type TextStyle } from "@/lib/text";
import { uid } from "@/lib/utils";

export const BLEND_MODES = [
  "source-over", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const blendLabel = (b: BlendMode) => (b === "source-over" ? "Normal" : b.replace(/(^|-)(\w)/g, (_, d, c) => (d ? " " : "") + c.toUpperCase()));

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  /** Centre position, size and rotation in document pixels / degrees. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface ImageLayer extends LayerBase {
  type: "image";
  assetId: string;
  adjustments: Adjustments;
  filter: FilterRef;
  /** Alpha mask bitmap (white = keep). Produced by the eraser and by background removal. */
  maskId: string | null;
  /** Drop shadow under the visible pixels (used by the product studio). */
  shadow: { enabled: boolean; color: string; blur: number; offsetY: number; opacity: number };
}
export interface TextLayer extends LayerBase { type: "text"; style: TextStyle }
export type ShapeKind = "rect" | "ellipse" | "triangle" | "star" | "line";
export interface ShapeLayer extends LayerBase {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}
/** Free-hand raster layer. `bitmapId` points at an immutable canvas snapshot. */
export interface PaintLayer extends LayerBase { type: "paint"; bitmapId: string }

export type Layer = ImageLayer | TextLayer | ShapeLayer | PaintLayer;

export interface PhotoDoc {
  width: number;
  height: number;
  /** CSS colour or "transparent". */
  background: string;
  /** Bottom-most layer first. */
  layers: Layer[];
}

export const emptyDoc = (width = 1920, height = 1080, background = "#ffffff"): PhotoDoc => ({ width, height, background, layers: [] });

const base = (name: string, x: number, y: number, w: number, h: number): LayerBase => ({
  id: uid(), name, visible: true, locked: false, opacity: 1, blend: "source-over", x, y, w, h, rotation: 0, flipX: false, flipY: false,
});

export const NO_SHADOW = { enabled: false, color: "#000000", blur: 40, offsetY: 24, opacity: 0.35 };

export function makeImageLayer(doc: PhotoDoc, assetId: string, name: string, iw: number, ih: number, fit = true): ImageLayer {
  const k = fit ? Math.min(1, doc.width / iw, doc.height / ih) : 1;
  return { ...base(name, doc.width / 2, doc.height / 2, iw * k, ih * k), type: "image", assetId, adjustments: { ...DEFAULT_ADJ }, filter: { ...NO_FILTER }, maskId: null, shadow: { ...NO_SHADOW } };
}

export function makeTextLayer(doc: PhotoDoc, x = doc.width / 2, y = doc.height / 2, patch: Partial<TextStyle> = {}): TextLayer {
  const style: TextStyle = { ...DEFAULT_TEXT, fontSize: Math.max(24, Math.round(doc.width / 16)), ...patch };
  const { w, h } = measureText(style);
  return { ...base(style.text.slice(0, 24) || "Text", x, y, w, h), type: "text", style };
}

export function makeShapeLayer(doc: PhotoDoc, shape: ShapeKind, x = doc.width / 2, y = doc.height / 2): ShapeLayer {
  const s = Math.round(Math.min(doc.width, doc.height) / 4);
  return {
    ...base(shape[0].toUpperCase() + shape.slice(1), x, y, s, shape === "line" ? Math.max(4, Math.round(s / 40)) : s),
    type: "shape", shape, fill: "#7c6cff", stroke: "#ffffff", strokeWidth: 0, radius: 0,
  };
}

export function makePaintLayer(doc: PhotoDoc, bitmapId: string): PaintLayer {
  return { ...base("Paint", doc.width / 2, doc.height / 2, doc.width, doc.height), type: "paint", bitmapId };
}

/** Converts a document point into a layer's local (unrotated, centre-origin) space. */
export function toLocal(l: LayerBase, px: number, py: number) {
  const r = (-l.rotation * Math.PI) / 180;
  const dx = px - l.x, dy = py - l.y;
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
}

export function hitLayer(doc: PhotoDoc, px: number, py: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible || l.locked) continue;
    const p = toLocal(l, px, py);
    const padY = l.type === "shape" && l.shape === "line" ? 8 : 0;
    if (Math.abs(p.x) <= l.w / 2 && Math.abs(p.y) <= l.h / 2 + padY) return l;
  }
  return null;
}
