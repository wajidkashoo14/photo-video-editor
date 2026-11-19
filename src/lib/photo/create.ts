import { importImage, newBitmap, persistBitmaps } from "@/lib/assets";
import { db } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { emptyDoc, makeImageLayer, type PhotoDoc } from "./types";

/**
 * Creates a photo project containing one image layer (optionally with a cut-out matte as its
 * non-destructive mask) and returns the editor URL.
 */
export async function photoProjectFromImage(name: string, image: Blob, opts: { matte?: HTMLCanvasElement; background?: string } = {}): Promise<string> {
  const p = await createProject("photo", name, 1, 1, {});
  const asset = await importImage(p.id, image, name);
  const doc: PhotoDoc = emptyDoc(asset.w, asset.h, opts.background ?? "#ffffff");
  const layer = makeImageLayer(doc, asset.id, name, asset.w, asset.h);
  if (opts.matte) {
    const k = Math.min(1, 4096 / Math.max(opts.matte.width, opts.matte.height));
    const { id } = newBitmap(opts.matte.width * k, opts.matte.height * k, opts.matte);
    await persistBitmaps(p.id, [id]);
    layer.maskId = id;
  }
  doc.layers.push(layer);
  await db.putProject({ ...p, width: doc.width, height: doc.height, data: { doc } });
  return `/photo?id=${p.id}`;
}
