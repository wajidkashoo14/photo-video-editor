/**
 * On-device image intelligence. Nothing here leaves the browser:
 *  - removeBackground runs a real segmentation network (ISNet via ONNX Runtime Web) in a worker.
 *  - autoColor and smartCrop are deterministic image analysis, not generative AI.
 */
import type { Adjustments } from "@/lib/adjustments";
import { clamp, makeCanvas } from "@/lib/utils";
import type { SegmentJob, SegmentReply } from "./segment.worker";

export type ProgressFn = (stage: string, fraction: number) => void;

interface SegmentTask {
  image: Blob;
  onProgress?: ProgressFn;
  resolve: (matte: HTMLCanvasElement) => void;
  reject: (error: Error) => void;
}

/**
 * One worker serves the tab for its whole life, as the engine on the page did before: a new worker
 * fetches the 84 MB model and starts the engine again, which took over 20 s in testing.
 */
let segmenter: Worker | null = null;
let running: SegmentTask | null = null;
const waiting: SegmentTask[] = [];

function startSegmenter() {
  const w = new Worker(new URL("./segment.worker.ts", import.meta.url));
  w.onmessage = (e: MessageEvent<SegmentReply>) => settle(e.data);
  // The worker failed to load or threw outside a job: it is not trusted with another one.
  w.onerror = (e) => {
    w.terminate();
    if (segmenter === w) segmenter = null;
    settle({ type: "error", stage: "load", message: e.message || "The background removal engine could not start." });
  };
  return w;
}

function nextSegment() {
  if (running || !waiting.length) return;
  running = waiting.shift()!;
  segmenter ??= startSegmenter();
  segmenter.postMessage({ image: running.image } satisfies SegmentJob);
}

function settle(reply: SegmentReply) {
  const task = running;
  if (!task) return;
  if (reply.type === "progress") {
    task.onProgress?.(reply.key.startsWith("fetch") ? "Downloading model" : "Analysing image", reply.total ? reply.current / reply.total : 0);
    return;
  }
  running = null;
  if (reply.type === "done") {
    try {
      const c = makeCanvas(reply.bitmap.width, reply.bitmap.height);
      c.getContext("2d")!.drawImage(reply.bitmap, 0, 0);
      task.resolve(c);
    } catch {
      task.reject(new Error("The image is too large for this browser to hold the result."));
    } finally {
      reply.bitmap.close();
    }
  } else {
    // The library caches a failed start, and a failed run can leave the engine unusable, so anything
    // but an unreadable image gets a fresh worker for the next job.
    if (reply.stage !== "decode") {
      segmenter?.terminate();
      segmenter = null;
    }
    task.reject(new Error(reply.message));
  }
  nextSegment();
}

/**
 * Returns a canvas whose alpha channel is the foreground matte for `source`. The model runs in a
 * worker, so the page stays responsive; calls are queued and run one at a time. The first call
 * downloads the model and engine (about 95 MB) from the library CDN.
 */
export function removeBackground(source: Blob, onProgress?: ProgressFn): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    waiting.push({ image: source, onProgress, resolve, reject });
    nextSegment();
  });
}

function sample(src: CanvasImageSource & { width: number; height: number }, edge: number) {
  const k = Math.min(1, edge / Math.max(src.width, src.height));
  const c = makeCanvas(src.width * k, src.height * k);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/**
 * Histogram-based automatic correction. Returns slider values (so the result stays
 * editable): levels stretched to the 0.5/99.5 percentiles, grey-world white balance,
 * and a mid-tone gamma nudge. Constants mirror the shader in gl/adjust.ts.
 */
export function autoColor(src: CanvasImageSource & { width: number; height: number }): Partial<Adjustments> {
  const { data } = sample(src, 256);
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    hist[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
  }
  if (!n) return {};
  const pct = (p: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) if ((acc += hist[i]) >= n * p) return i / 255;
    return 1;
  };
  const lo = pct(0.005), hi = pct(0.995), mid = pct(0.5);
  r /= n; g /= n; b /= n;
  const blacks = clamp((-lo / 0.14) * 100, -100, 0);
  const whites = clamp(((1 - hi) / 0.22) * 100, 0, 100);
  const m = clamp((mid - lo) / Math.max(0.05, hi - lo), 0.02, 0.98);
  const gamma = clamp(-Math.log2(Math.log(0.46) / Math.log(m)) * 50, -40, 40);
  const temperature = clamp(((b - r) / (0.28 * (r + b))) * 60, -40, 40);
  const tint = clamp(((g - (r + b) / 2) / (0.2 * g || 1)) * 50, -30, 30);
  return { blacks: Math.round(blacks), whites: Math.round(whites), gamma: Math.round(gamma), temperature: Math.round(temperature), tint: Math.round(tint), vibrance: 12 };
}

/**
 * Saliency-driven crop: scores every window of the requested aspect ratio by edge
 * energy + colourfulness (integral image) and returns the best one in source pixels.
 */
export function smartCrop(src: CanvasImageSource & { width: number; height: number }, aspect: number) {
  const { data, w, h } = sample(src, 160);
  const energy = new Float32Array(w * h);
  const lum = (i: number) => 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const gx = lum(i + 4) - lum(i - 4), gy = lum(i + w * 4) - lum(i - w * 4);
      const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      // Centre bias keeps flat images from snapping to a corner.
      const cb = 1 - 0.35 * Math.hypot(x / w - 0.5, y / h - 0.5);
      energy[y * w + x] = (Math.hypot(gx, gy) + sat * 0.4) * cb * (data[i + 3] / 255);
    }
  const W1 = w + 1;
  const integ = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += energy[y * w + x];
      integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row;
    }
  }
  let cw = w, chh = Math.round(w / aspect);
  if (chh > h) {
    chh = h;
    cw = Math.round(h * aspect);
  }
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y + chh <= h; y++)
    for (let x = 0; x + cw <= w; x++) {
      const sum = integ[(y + chh) * W1 + x + cw] - integ[y * W1 + x + cw] - integ[(y + chh) * W1 + x] + integ[y * W1 + x];
      if (sum > best) { best = sum; bx = x; by = y; }
    }
  const k = src.width / w;
  return { x: bx * k, y: by * k, w: cw * k, h: chh * k };
}
