import { classifyFile } from "@/config/app";
import { importImage } from "@/lib/assets";
import { db } from "@/lib/db";
import { canvasToBlob, safeName, uid } from "@/lib/utils";
import { usePhoto, type CropRect } from "@/stores/photoStore";
import { flattenDoc } from "./render";
import { makeImageLayer, type Layer, type PhotoDoc } from "./types";

/** Imports image files as new layers. The first image in an empty document sets the canvas size. */
export async function addImageFiles(files: Iterable<File>): Promise<string[]> {
  const errors: string[] = [];
  for (const file of files) {
    try {
      if (classifyFile(file) !== "image") throw new Error(`"${file.name}" is not an image.`);
      const s = usePhoto.getState();
      if (!s.projectId) throw new Error("No project is open.");
      const asset = await importImage(s.projectId, file, file.name);
      const first = s.doc.layers.length === 0;
      if (first) {
        s.setDoc((d) => ({ ...d, width: asset.w, height: asset.h }), true);
        usePhoto.setState({ fitNonce: usePhoto.getState().fitNonce + 1 });
      }
      const doc = usePhoto.getState().doc;
      usePhoto.getState().setDoc((d) => ({ ...d, layers: [...d.layers, makeImageLayer(doc, asset.id, file.name.replace(/\.\w+$/, ""), asset.w, asset.h)] }), !first);
      const layers = usePhoto.getState().doc.layers;
      usePhoto.setState({ selectedId: layers[layers.length - 1].id });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `Could not open "${file.name}".`);
    }
  }
  return errors;
}

const mapLayers = (d: PhotoDoc, fn: (l: Layer) => Layer): Layer[] => d.layers.map(fn);

export function applyCrop(r: CropRect) {
  const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
  usePhoto.getState().setDoc((d) => ({ ...d, width: rect.w, height: rect.h, layers: mapLayers(d, (l) => ({ ...l, x: l.x - rect.x, y: l.y - rect.y })) }));
  usePhoto.setState({ crop: null, tool: "move", fitNonce: usePhoto.getState().fitNonce + 1 });
}

export function rotateDoc90(clockwise = true) {
  usePhoto.getState().setDoc((d) => ({
    ...d,
    width: d.height,
    height: d.width,
    layers: mapLayers(d, (l) => ({
      ...l,
      x: clockwise ? d.height - l.y : l.y,
      y: clockwise ? l.x : d.width - l.x,
      rotation: l.rotation + (clockwise ? 90 : -90),
    })),
  }));
  usePhoto.setState({ fitNonce: usePhoto.getState().fitNonce + 1, crop: null });
}

export function flipDoc(axis: "h" | "v") {
  usePhoto.getState().setDoc((d) => ({
    ...d,
    layers: mapLayers(d, (l) =>
      axis === "h" ? { ...l, x: d.width - l.x, rotation: -l.rotation, flipX: !l.flipX } : { ...l, y: d.height - l.y, rotation: -l.rotation, flipY: !l.flipY },
    ),
  }));
}

/** Rotates every layer around the document centre (straighten). No history entry when `history` is false. */
export function rotateAll(deg: number, history: boolean) {
  const r = (deg * Math.PI) / 180;
  usePhoto.getState().setDoc((d) => {
    const cx = d.width / 2, cy = d.height / 2;
    return {
      ...d,
      layers: mapLayers(d, (l) => {
        const dx = l.x - cx, dy = l.y - cy;
        return { ...l, x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r), rotation: l.rotation + deg };
      }),
    };
  }, history);
}

export function resizeDoc(w: number, h: number, scaleContent: boolean) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  usePhoto.getState().setDoc((d) => {
    if (!scaleContent) {
      const ox = (w - d.width) / 2, oy = (h - d.height) / 2;
      return { ...d, width: w, height: h, layers: mapLayers(d, (l) => ({ ...l, x: l.x + ox, y: l.y + oy })) };
    }
    const sx = w / d.width, sy = h / d.height, s = Math.min(sx, sy);
    return {
      ...d,
      width: w,
      height: h,
      layers: mapLayers(d, (l) => {
        const n = { ...l, x: l.x * sx, y: l.y * sy, w: l.w * s, h: l.h * s } as Layer;
        if (n.type === "text") n.style = { ...n.style, fontSize: n.style.fontSize * s, strokeWidth: n.style.strokeWidth * s, bgPadding: n.style.bgPadding * s, letterSpacing: n.style.letterSpacing * s };
        if (n.type === "shape") n.strokeWidth *= s;
        return n;
      }),
    };
  });
  usePhoto.setState({ fitNonce: usePhoto.getState().fitNonce + 1, crop: null });
}

export interface ImageExportOpts { format: "png" | "jpeg" | "webp"; quality: number; scale: number }

/** Renders the document at full resolution and returns the encoded file. Also records it in Export History. */
export async function exportDoc(o: ImageExportOpts): Promise<{ blob: Blob; filename: string; width: number; height: number }> {
  const s = usePhoto.getState();
  let doc = s.doc;
  // JPEG has no alpha channel; flatten transparency onto white so it does not turn black.
  if (o.format === "jpeg" && doc.background === "transparent") doc = { ...doc, background: "#ffffff" };
  const canvas = flattenDoc(doc, o.scale, false);
  const mime = `image/${o.format}`;
  const blob = await canvasToBlob(canvas, mime, o.format === "png" ? undefined : o.quality);
  const filename = `${safeName(s.name)}.${o.format === "jpeg" ? "jpg" : o.format}`;
  await db.putExport({
    id: uid(), projectId: s.projectId ?? "", projectName: s.name, kind: "photo", filename, mime,
    width: canvas.width, height: canvas.height, size: blob.size, createdAt: Date.now(), blob,
  });
  return { blob, filename, width: canvas.width, height: canvas.height };
}
