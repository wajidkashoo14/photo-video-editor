import { LIMITS } from "@/config/app";
import { db, type AssetRecord } from "@/lib/db";
import { canvasToBlob, makeCanvas, uid } from "@/lib/utils";

/** Decoded still image: full resolution for export plus a capped preview for interaction. */
export interface ImageAsset {
  id: string;
  full: ImageBitmap;
  preview: HTMLCanvasElement | ImageBitmap;
  w: number;
  h: number;
}

const images = new Map<string, ImageAsset>();
const loading = new Map<string, Promise<ImageAsset | null>>();
/** Mutable-by-replacement raster canvases (paint layers, masks), keyed by immutable id. */
const bitmaps = new Map<string, HTMLCanvasElement>();
const persistedBitmaps = new Set<string>();
const listeners = new Set<() => void>();

export const onAssetsChanged = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};
let version = 0;
/** Increases whenever an image or bitmap finishes loading; lets React re-read derived data. */
export const assetsVersion = () => version;
const notify = () => {
  version++;
  listeners.forEach((f) => f());
};

async function decode(id: string, blob: Blob): Promise<ImageAsset> {
  const full = await createImageBitmap(blob);
  const k = Math.min(1, LIMITS.previewEdge / Math.max(full.width, full.height));
  let preview: HTMLCanvasElement | ImageBitmap = full;
  if (k < 1) {
    const c = makeCanvas(full.width * k, full.height * k);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, c.width, c.height);
    preview = c;
  }
  const a = { id, full, preview, w: full.width, h: full.height };
  images.set(id, a);
  return a;
}

export const getImage = (id: string) => images.get(id);

/** Returns the decoded image, loading it from IndexedDB on first use. */
export function ensureImage(id: string): Promise<ImageAsset | null> {
  const hit = images.get(id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(id);
  if (!p) {
    p = db
      .getAsset(id)
      .then((rec) => (rec ? decode(id, rec.blob) : null))
      .then((a) => {
        loading.delete(id);
        if (a) notify();
        return a;
      })
      .catch(() => null);
    loading.set(id, p);
  }
  return p;
}

/** Stores a new image blob for a project and decodes it. */
export async function importImage(projectId: string, blob: Blob, name: string): Promise<ImageAsset> {
  const id = uid();
  const a = await decode(id, blob); // decode first so unreadable files never get stored
  const rec: AssetRecord = { id, projectId, name, mime: blob.type || "image/png", kind: "image", blob, meta: { w: a.w, h: a.h } };
  await db.putAsset(rec);
  return a;
}

/* ---- raster bitmaps ---- */
export const getBitmap = (id: string) => bitmaps.get(id);

export function newBitmap(w: number, h: number, from?: CanvasImageSource, fill?: string): { id: string; canvas: HTMLCanvasElement } {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (from) ctx.drawImage(from, 0, 0, canvas.width, canvas.height);
  const id = uid();
  bitmaps.set(id, canvas);
  return { id, canvas };
}

export async function ensureBitmap(id: string): Promise<HTMLCanvasElement | null> {
  const hit = bitmaps.get(id);
  if (hit) return hit;
  const rec = await db.getAsset(id);
  if (!rec) return null;
  const bmp = await createImageBitmap(rec.blob);
  const c = makeCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  bitmaps.set(id, c);
  persistedBitmaps.add(id);
  notify();
  return c;
}

/** Writes any not-yet-saved bitmaps referenced by the project to IndexedDB. */
export async function persistBitmaps(projectId: string, ids: string[]) {
  for (const id of ids) {
    if (persistedBitmaps.has(id)) continue;
    const c = bitmaps.get(id);
    if (!c) continue;
    const blob = await canvasToBlob(c, "image/png");
    await db.putAsset({ id, projectId, name: "bitmap", mime: "image/png", kind: "bitmap", blob });
    persistedBitmaps.add(id);
  }
}

/** Drops in-memory bitmaps that nothing references any more (called after history trims). */
export function pruneBitmaps(keep: Set<string>) {
  for (const id of bitmaps.keys()) if (!keep.has(id)) bitmaps.delete(id);
}
