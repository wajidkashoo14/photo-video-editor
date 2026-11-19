"use client";

import { create } from "zustand";
import { LIMITS } from "@/config/app";
import { ensureBitmap, ensureImage, persistBitmaps, pruneBitmaps } from "@/lib/assets";
import { db, type ProjectRecord } from "@/lib/db";
import { flattenDoc, forgetLayer } from "@/lib/photo/render";
import { emptyDoc, type Layer, type PhotoDoc, type ShapeKind } from "@/lib/photo/types";
import { measureText } from "@/lib/text";
import { uid } from "@/lib/utils";

export type Tool = "move" | "hand" | "crop" | "text" | "shape" | "brush" | "eraser" | "clone";
export interface CropRect { x: number; y: number; w: number; h: number }
export interface View { zoom: number; x: number; y: number }

interface PhotoState {
  projectId: string | null;
  name: string;
  createdAt: number;
  doc: PhotoDoc;
  selectedId: string | null;
  tool: Tool;
  shapeKind: ShapeKind;
  brush: { size: number; color: string; opacity: number };
  view: View;
  /** Bumped to ask the canvas to re-fit the document in the viewport. */
  fitNonce: number;
  crop: CropRect | null;
  cropAspect: number | null;
  compare: boolean;
  past: PhotoDoc[];
  future: PhotoDoc[];
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;

  load: (p: ProjectRecord) => Promise<void>;
  set: (patch: Partial<PhotoState>) => void;
  /** Records the current document for undo. Call once before a continuous edit (drag, slider). */
  snapshot: () => void;
  setDoc: (fn: (d: PhotoDoc) => PhotoDoc, history?: boolean) => void;
  updateLayer: (id: string, patch: Partial<Layer>, history?: boolean) => void;
  addLayer: (l: Layer) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayer: (id: string, dir: 1 | -1 | "top" | "bottom") => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
}

const bitmapIds = (docs: PhotoDoc[]) => {
  const ids = new Set<string>();
  for (const d of docs) for (const l of d.layers) {
    if (l.type === "paint") ids.add(l.bitmapId);
    if (l.type === "image" && l.maskId) ids.add(l.maskId);
  }
  return ids;
};

export const usePhoto = create<PhotoState>((set, get) => ({
  projectId: null,
  name: "Untitled",
  createdAt: 0,
  doc: emptyDoc(),
  selectedId: null,
  tool: "move",
  shapeKind: "rect",
  brush: { size: 40, color: "#ff3b6b", opacity: 1 },
  view: { zoom: 1, x: 0, y: 0 },
  fitNonce: 0,
  crop: null,
  cropAspect: null,
  compare: false,
  past: [],
  future: [],
  dirty: false,
  saving: false,
  savedAt: null,

  async load(p) {
    const doc = (p.data as { doc?: PhotoDoc })?.doc ?? emptyDoc(p.width, p.height);
    set({ projectId: p.id, name: p.name, createdAt: p.createdAt, doc, selectedId: null, past: [], future: [], dirty: false, savedAt: p.updatedAt, crop: null, tool: "move", fitNonce: get().fitNonce + 1 });
    await Promise.all(
      doc.layers.flatMap((l) =>
        l.type === "image" ? [ensureImage(l.assetId), l.maskId ? ensureBitmap(l.maskId) : null] : l.type === "paint" ? [ensureBitmap(l.bitmapId)] : [],
      ),
    );
  },

  set: (patch) => set(patch),

  snapshot() {
    const { past, doc } = get();
    if (past[past.length - 1] === doc) return;
    const next = [...past, doc].slice(-LIMITS.historyDepth);
    set({ past: next, future: [] });
  },

  setDoc(fn, history = true) {
    if (history) get().snapshot();
    set({ doc: fn(get().doc), dirty: true });
  },

  updateLayer(id, patch, history = true) {
    get().setDoc(
      (d) => ({
        ...d,
        layers: d.layers.map((l) => {
          if (l.id !== id) return l;
          const n = { ...l, ...patch } as Layer;
          if (n.type === "text" && "style" in patch) {
            const m = measureText(n.style);
            n.w = m.w;
            n.h = m.h;
            n.name = n.style.text.split("\n")[0].slice(0, 24) || "Text";
          }
          return n;
        }),
      }),
      history,
    );
  },

  addLayer(l) {
    get().setDoc((d) => ({ ...d, layers: [...d.layers, l] }));
    set({ selectedId: l.id });
  },

  removeLayer(id) {
    get().setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    forgetLayer(id);
    if (get().selectedId === id) set({ selectedId: null });
  },

  duplicateLayer(id) {
    const l = get().doc.layers.find((x) => x.id === id);
    if (!l) return;
    const copy = { ...structuredClone(l), id: uid(), name: `${l.name} copy`, x: l.x + 24, y: l.y + 24 };
    get().setDoc((d) => {
      const i = d.layers.findIndex((x) => x.id === id);
      const layers = [...d.layers];
      layers.splice(i + 1, 0, copy);
      return { ...d, layers };
    });
    set({ selectedId: copy.id });
  },

  reorderLayer(id, dir) {
    get().setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      if (i < 0) return d;
      const layers = [...d.layers];
      const [l] = layers.splice(i, 1);
      const j = dir === "top" ? layers.length : dir === "bottom" ? 0 : Math.max(0, Math.min(layers.length, i + dir));
      layers.splice(j, 0, l);
      return { ...d, layers };
    });
  },

  undo() {
    const { past, future, doc } = get();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], dirty: true, crop: null });
  },

  redo() {
    const { past, future, doc } = get();
    if (!future.length) return;
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], dirty: true, crop: null });
  },

  async save() {
    const s = get();
    if (!s.projectId || s.saving) return;
    set({ saving: true });
    try {
      const doc = s.doc;
      await persistBitmaps(s.projectId, [...bitmapIds([doc])]);
      pruneBitmaps(bitmapIds([doc, ...get().past, ...get().future]));
      let thumbnail: string | undefined;
      try {
        thumbnail = flattenDoc(doc, Math.min(1, 360 / Math.max(doc.width, doc.height)), true).toDataURL("image/webp", 0.75);
      } catch {
        /* thumbnail is best-effort */
      }
      const now = Date.now();
      await db.putProject({ id: s.projectId, name: s.name, kind: "photo", createdAt: s.createdAt || now, updatedAt: now, width: doc.width, height: doc.height, thumbnail, data: { doc } });
      // Only clear the dirty flag if nothing changed while we were writing.
      set({ saving: false, savedAt: now, dirty: get().doc !== doc });
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },
}));
