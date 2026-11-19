import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from "mediabunny";
import { classifyFile } from "@/config/app";
import { db, type AssetRecord } from "@/lib/db";
import { makeCanvas, uid } from "@/lib/utils";
import type { MediaAsset } from "./types";

const STRIP_FRAMES = 12;
const THUMB_W = 160;

type Meta = Pick<MediaAsset, "duration" | "width" | "height" | "hasAudio" | "thumb" | "strip" | "peaks" | "peaksPerSec">;

const toDataUrl = (src: CanvasImageSource, w: number, h: number) => {
  const c = makeCanvas(w, h);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
};

/** Reads duration/dimensions and renders thumbnails by demuxing only the packets it needs. */
async function probeWithMediabunny(blob: Blob): Promise<Meta> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    const meta: Meta = { duration, width: vt?.displayWidth ?? 0, height: vt?.displayHeight ?? 0, hasAudio: !!at };
    if (vt && (await vt.canDecode())) {
      const sink = new CanvasSink(vt, { width: THUMB_W });
      const times = Array.from({ length: STRIP_FRAMES }, (_, i) => (duration * (i + 0.5)) / STRIP_FRAMES);
      const strip: string[] = [];
      for await (const wc of sink.canvasesAtTimestamps(times)) if (wc) strip.push(toDataUrl(wc.canvas, wc.canvas.width, wc.canvas.height));
      meta.strip = strip;
      meta.thumb = strip[Math.min(1, strip.length - 1)];
    }
    return meta;
  } finally {
    input.dispose();
  }
}

/** Fallback for containers the demuxer cannot read: ask the browser's own media element. */
function probeWithElement(blob: Blob, kind: "video" | "audio"): Promise<Meta> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    const done = (fn: () => void) => {
      fn();
      URL.revokeObjectURL(url);
    };
    el.preload = "metadata";
    el.muted = true;
    el.onerror = () => done(() => reject(new Error("This browser cannot decode the file.")));
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      const meta: Meta = { duration: el.duration, width: v.videoWidth ?? 0, height: v.videoHeight ?? 0, hasAudio: true };
      if (kind === "audio" || !v.videoWidth) return done(() => resolve(meta));
      v.onseeked = () => {
        meta.thumb = toDataUrl(v, THUMB_W, (THUMB_W * v.videoHeight) / v.videoWidth);
        done(() => resolve(meta));
      };
      v.currentTime = Math.min(1, el.duration / 2);
    };
    el.src = url;
  });
}

/** Streams decoded audio through a peak detector; never holds the whole track in memory. */
export async function computePeaks(blob: Blob): Promise<{ peaks: number[]; peaksPerSec: number } | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at || !(await at.canDecode())) return null;
    const duration = await input.computeDuration();
    const peaksPerSec = Math.max(1, Math.min(25, 5000 / Math.max(1, duration)));
    const peaks = new Float32Array(Math.ceil(duration * peaksPerSec) + 1);
    let max = 0;
    for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers()) {
      const data = buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(buffer.sampleRate / peaksPerSec / 16));
      for (let i = 0; i < data.length; i += step) {
        const idx = Math.floor((timestamp + i / buffer.sampleRate) * peaksPerSec);
        const v = Math.abs(data[i]);
        if (idx >= 0 && idx < peaks.length && v > peaks[idx]) peaks[idx] = v;
        if (v > max) max = v;
      }
    }
    return { peaks: Array.from(peaks, (v) => Math.round((v / (max || 1)) * 100) / 100), peaksPerSec };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

const toAsset = (rec: AssetRecord): MediaAsset => ({
  id: rec.id, name: rec.name, kind: rec.kind as MediaAsset["kind"], mime: rec.mime, size: rec.blob.size,
  url: URL.createObjectURL(rec.blob), blob: rec.blob, duration: 0, width: 0, height: 0, hasAudio: false, ...(rec.meta as Partial<Meta>),
});

/** Validates, probes and stores a media file. Waveform peaks arrive later via `onPeaks`. */
export async function importMedia(projectId: string, file: File, onPeaks?: (id: string, p: { peaks: number[]; peaksPerSec: number }) => void): Promise<MediaAsset> {
  const kind = classifyFile(file);
  let meta: Meta;
  if (kind === "image") {
    const bmp = await createImageBitmap(file);
    meta = { duration: 5, width: bmp.width, height: bmp.height, hasAudio: false, thumb: toDataUrl(bmp, THUMB_W, (THUMB_W * bmp.height) / bmp.width) };
    bmp.close();
  } else {
    try {
      meta = await probeWithMediabunny(file);
    } catch {
      meta = await probeWithElement(file, kind);
    }
    if (kind === "audio") meta.hasAudio = true;
    if (!Number.isFinite(meta.duration) || meta.duration <= 0) throw new Error(`"${file.name}" has no readable duration.`);
  }
  const rec: AssetRecord = { id: uid(), projectId, name: file.name, mime: file.type, kind, blob: file, meta: meta as unknown as Record<string, unknown> };
  await db.putAsset(rec);
  if (meta.hasAudio && onPeaks) {
    computePeaks(file).then(async (p) => {
      if (!p) return;
      await db.putAsset({ ...rec, meta: { ...meta, ...p } });
      onPeaks(rec.id, p);
    });
  }
  return toAsset(rec);
}

export async function loadProjectMedia(projectId: string): Promise<MediaAsset[]> {
  const recs = await db.listAssets(projectId);
  return recs.filter((r) => r.kind === "video" || r.kind === "audio" || r.kind === "image").map(toAsset);
}
