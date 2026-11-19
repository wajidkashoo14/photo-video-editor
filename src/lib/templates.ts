import { emptyDoc, makeShapeLayer, makeTextLayer, type Layer, type PhotoDoc, type ShapeKind } from "@/lib/photo/types";
import type { TextStyle } from "@/lib/text";

export interface Template {
  id: string;
  name: string;
  category: string;
  /** Builds editable layers for any canvas size using the given palette [accent, dark, light, highlight]. */
  build: (w: number, h: number, palette: string[]) => PhotoDoc;
}

/** Helpers place layers with fractions of the canvas so every template adapts to any size. */
function kit(w: number, h: number) {
  const doc = emptyDoc(w, h);
  const u = Math.min(w, h) / 100; // 1% of the short edge
  const shape = (kind: ShapeKind, fx: number, fy: number, fw: number, fh: number, fill: string, patch: Partial<Layer> = {}) => {
    const l = makeShapeLayer(doc, kind, fx * w, fy * h);
    doc.layers.push({ ...l, w: fw * w, h: fh * h, fill, ...patch } as Layer);
  };
  const text = (content: string, fx: number, fy: number, size: number, color: string, patch: Partial<TextStyle> = {}) => {
    doc.layers.push(makeTextLayer(doc, fx * w, fy * h, { text: content, fontSize: Math.round(size * u), color, ...patch }));
  };
  return { doc, u, shape, text };
}

export const TEMPLATES: Template[] = [
  {
    id: "product-ad", name: "Product advertisement", category: "Advertising",
    build(w, h, [accent, dark, light, hi]) {
      const k = kit(w, h);
      k.doc.background = light;
      k.shape("ellipse", 0.5, 0.52, 0.62 * Math.min(1, h / w), 0.62 * Math.min(1, w / h), accent, { opacity: 0.16 });
      k.text("NEW ARRIVAL", 0.5, 0.12, 4.2, accent, { letterSpacing: 6, fontWeight: 700 });
      k.text("Your product\nheadline", 0.5, 0.25, 9, dark, { fontWeight: 800, lineHeight: 1.05 });
      k.text("Drop your product photo in the middle", 0.5, 0.52, 3, dark, { fontWeight: 500 });
      k.shape("ellipse", 0.82, 0.7, 0.2 * Math.min(1, h / w), 0.2 * Math.min(1, w / h), hi);
      k.text("-30%", 0.82, 0.7, 5.5, dark, { fontWeight: 900 });
      k.shape("rect", 0.5, 0.88, 0.42, 0.075, dark, { radius: 999 });
      k.text("Shop now", 0.5, 0.88, 3.6, light, { fontWeight: 700 });
      return k.doc;
    },
  },
  {
    id: "business-promo", name: "Business promotion", category: "Advertising",
    build(w, h, [accent, dark, light, hi]) {
      const k = kit(w, h);
      k.doc.background = dark;
      k.shape("rect", 0.5, 0.5, 0.9, 0.9, "#00000000", { stroke: accent, strokeWidth: k.u * 0.5 } as Partial<Layer>);
      k.shape("rect", 0.5, 0.2, 0.18, 0.008, hi);
      k.text("GRAND OPENING", 0.5, 0.14, 3.6, hi, { letterSpacing: 8, fontWeight: 600 });
      k.text("Big ideas.\nBetter prices.", 0.5, 0.4, 10, light, { fontWeight: 800, lineHeight: 1.08 });
      k.text("Join us this Saturday for exclusive launch offers", 0.5, 0.62, 3.2, light, { fontWeight: 400 });
      k.shape("rect", 0.5, 0.78, 0.5, 0.085, accent, { radius: 14 });
      k.text("Book your spot", 0.5, 0.78, 3.8, "#ffffff", { fontWeight: 700 });
      k.text("yourbusiness.com", 0.5, 0.9, 2.6, hi, { fontWeight: 500 });
      return k.doc;
    },
  },
  {
    id: "travel", name: "Travel content", category: "Lifestyle",
    build(w, h, [accent, dark, light, hi]) {
      const k = kit(w, h);
      k.doc.background = "#1f6f8b";
      k.shape("rect", 0.5, 0.82, 1, 0.36, dark, { opacity: 0.55 });
      k.shape("ellipse", 0.8, 0.18, 0.16 * Math.min(1, h / w), 0.16 * Math.min(1, w / h), hi);
      k.text("EXPLORE", 0.5, 0.36, 15, light, { fontWeight: 900, letterSpacing: 10 });
      k.text("the coast less travelled", 0.5, 0.48, 4.4, light, { italic: true, fontFamily: "Georgia", fontWeight: 400 });
      k.text("7 days · 4 islands · 1 unforgettable trip", 0.5, 0.78, 3.2, light, { fontWeight: 500 });
      k.shape("rect", 0.5, 0.88, 0.36, 0.065, accent, { radius: 999 });
      k.text("See the route", 0.5, 0.88, 3, "#ffffff", { fontWeight: 700 });
      return k.doc;
    },
  },
  {
    id: "portfolio", name: "Photography portfolio", category: "Lifestyle",
    build(w, h, [accent, dark, light]) {
      const k = kit(w, h);
      k.doc.background = light;
      k.shape("rect", 0.5, 0.42, 0.78, 0.6, "#d9d9de");
      k.text("Place your photo here", 0.5, 0.42, 3, "#8a8a94", { fontWeight: 500 });
      k.shape("rect", 0.11 + 0.06, 0.8, 0.12, 0.006, accent);
      k.text("Portfolio 2026", 0.5, 0.82, 7, dark, { fontFamily: "Georgia", fontWeight: 400 });
      k.text("YOUR NAME · PHOTOGRAPHER", 0.5, 0.91, 2.6, dark, { letterSpacing: 6, fontWeight: 600 });
      return k.doc;
    },
  },
  {
    id: "event", name: "Event invitation", category: "Events",
    build(w, h, [accent, dark, , hi]) {
      const k = kit(w, h);
      k.doc.background = "#f7f1e8";
      k.shape("rect", 0.5, 0.5, 0.88, 0.9, "#00000000", { stroke: hi, strokeWidth: k.u * 0.35 } as Partial<Layer>);
      k.shape("star", 0.5, 0.15, 0.07 * Math.min(1, h / w), 0.07 * Math.min(1, w / h), hi);
      k.text("YOU ARE INVITED", 0.5, 0.26, 3.2, dark, { letterSpacing: 8, fontWeight: 600 });
      k.text("Summer\nGarden Party", 0.5, 0.44, 10, dark, { fontFamily: "Georgia", italic: true, fontWeight: 400, lineHeight: 1.1 });
      k.shape("rect", 0.5, 0.6, 0.12, 0.005, accent);
      k.text("Saturday 14 June · 6 pm", 0.5, 0.68, 3.8, dark, { fontWeight: 600 });
      k.text("12 Orchard Lane, Your City", 0.5, 0.75, 3, dark, { fontWeight: 400 });
      k.text("RSVP by 1 June", 0.5, 0.87, 2.8, accent, { fontWeight: 700, letterSpacing: 3 });
      return k.doc;
    },
  },
  {
    id: "announcement", name: "Brand announcement", category: "Brand",
    build(w, h, [accent, dark, light, hi]) {
      const k = kit(w, h);
      k.doc.background = accent;
      k.shape("ellipse", 0.9, 0.1, 0.5 * Math.min(1, h / w), 0.5 * Math.min(1, w / h), "#ffffff", { opacity: 0.1 });
      k.shape("ellipse", 0.08, 0.95, 0.4 * Math.min(1, h / w), 0.4 * Math.min(1, w / h), dark, { opacity: 0.18 });
      k.shape("rect", 0.5, 0.3, 0.3, 0.055, dark, { radius: 999 });
      k.text("ANNOUNCEMENT", 0.5, 0.3, 2.6, hi, { letterSpacing: 6, fontWeight: 700 });
      k.text("Something new\nis coming", 0.5, 0.5, 10.5, "#ffffff", { fontWeight: 800, lineHeight: 1.05 });
      k.text("Stay tuned · 01.09", 0.5, 0.7, 3.6, light, { fontWeight: 500 });
      return k.doc;
    },
  },
  {
    id: "showcase", name: "Product showcase", category: "Advertising",
    build(w, h, [accent, dark, , hi]) {
      const k = kit(w, h);
      k.doc.background = "#eeeef2";
      k.shape("rect", 0.5, 0.45, 0.7, 0.56, "#ffffff", { radius: k.u * 3 });
      k.text("Product photo", 0.5, 0.45, 3, "#a0a0aa", { fontWeight: 500 });
      k.text("Product name", 0.5, 0.8, 6.5, dark, { fontWeight: 800 });
      k.text("Short benefit-led description", 0.5, 0.87, 3, "#55555f", { fontWeight: 400 });
      k.shape("rect", 0.5, 0.94, 0.2, 0.05, accent, { radius: 999 });
      k.text("$49", 0.5, 0.94, 3, "#ffffff", { fontWeight: 800 });
      k.shape("rect", 0.2, 0.2, 0.14, 0.04, hi, { radius: 6, rotation: -8 });
      k.text("BESTSELLER", 0.2, 0.2, 1.7, dark, { fontWeight: 800 });
      doc_rotateLast(k.doc, -8);
      return k.doc;
    },
  },
];

function doc_rotateLast(doc: PhotoDoc, deg: number) {
  const l = doc.layers[doc.layers.length - 1];
  if (l) l.rotation = deg;
}
