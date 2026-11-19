/**
 * Video compression on the device: probe a file, plan the encode, re-encode with Mediabunny's
 * conversion pipeline (WebCodecs) and measure the result against the original with SSIM.
 *
 * Quality goals use constant-quality (quantizer) encoding where the encoder supports it, so busy
 * scenes get the bits they need and simple ones don't waste any. "Target size" uses a bitrate
 * budget with one corrective pass if the first encode overshoots.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type DiscardedTrack,
  type VideoCodec,
} from "mediabunny";
import { makeCanvas } from "@/lib/utils";

export type Goal = "lossless" | "balanced" | "smallest" | "size";
export type CodecId = Extract<VideoCodec, "avc" | "hevc" | "av1" | "vp9">;

export const GOALS: { id: Goal; label: string; desc: string }[] = [
  { id: "lossless", label: "Visually lossless", desc: "No visible difference. Big savings on phone and camera footage." },
  { id: "balanced", label: "Balanced", desc: "Much smaller. Slight softening if you look closely." },
  { id: "smallest", label: "Smallest", desc: "Smallest file at the same resolution. Some visible loss." },
  { id: "size", label: "Target size", desc: "Fit under a limit, for example for email or a chat app." },
];

export const CODECS: { id: CodecId; label: string; note: string; container: "mp4" | "webm" }[] = [
  { id: "avc", label: "H.264 · MP4", note: "Plays everywhere.", container: "mp4" },
  { id: "hevc", label: "HEVC · MP4", note: "Smaller. Plays on Apple devices, most phones and TVs; Windows needs the HEVC extension.", container: "mp4" },
  { id: "av1", label: "AV1 · MP4", note: "Smallest. Plays in browsers, on Android and newer devices. Slow to encode without hardware support.", container: "mp4" },
  { id: "vp9", label: "VP9 · WebM", note: "Smaller. Plays in browsers and on Android.", container: "webm" },
];

/** Position on Mediabunny's 0-1 quality scale. With quantizer support, 0.85 is H.264/HEVC QP 20, AV1/VP9 q 99 of 255. */
const GOAL_QUALITY: Record<Exclude<Goal, "size">, number> = { lossless: 0.85, balanced: 0.7, smallest: 0.5 };
const AUDIO_KBPS: Record<Goal, number> = { lossless: 192, balanced: 160, smallest: 128, size: 128 };
/** Rough bits needed relative to H.264 for the same quality, used only to pick a resolution for a size budget. */
const EFFICIENCY: Record<CodecId, number> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.45 };
/** Audio codecs that are already compressed and can be copied as they are. */
const COPYABLE_AUDIO = new Set(["aac", "opus", "mp3", "vorbis", "ac3", "eac3"]);

export interface CompressSettings {
  goal: Goal;
  targetMB: number;
  codec: CodecId;
  /** Largest short edge of the output; null keeps the original size. Never upscales. */
  maxEdge: number | null;
  keepAudio: boolean;
}

export const DEFAULT_COMPRESS: CompressSettings = { goal: "lossless", targetMB: 25, codec: "avc", maxEdge: null, keepAudio: true };

export interface VideoProbe {
  size: number;
  duration: number;
  /** Display size, after rotation metadata. */
  width: number;
  height: number;
  fps: number | null;
  codec: string | null;
  videoBitrate: number | null;
  audio: { codec: string | null; bitrate: number | null; channels: number; sampleRate: number } | null;
  hdr: boolean;
  poster: string | null;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const finite = (n: number | undefined | null) => (n != null && Number.isFinite(n) && n > 0 ? n : null);
const openInput = (blob: Blob) => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

export const CODEC_NAMES: Record<string, string> = { avc: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", aac: "AAC", opus: "Opus", mp3: "MP3", vorbis: "Vorbis", flac: "FLAC", ac3: "AC-3", eac3: "E-AC-3" };
export const codecName = (c: string | null | undefined) => (c ? (CODEC_NAMES[c] ?? (c.startsWith("pcm") ? "PCM" : c.toUpperCase())) : "Unknown");

/** Reads what is needed to plan the encode: size, frame rate, codecs, bitrates, HDR, plus a small poster frame. */
export async function probeVideo(file: Blob): Promise<VideoProbe> {
  const input = openInput(file);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("This file has no video track.");
    if (!(await video.canDecode())) throw new Error(`This browser cannot decode ${codecName(video.codec)} video, so it cannot compress this file.`);
    const audio = await input.getPrimaryAudioTrack();
    const [duration, stats, hdr, aStats] = await Promise.all([
      input.computeDuration(),
      video.computePacketStats(),
      video.hasHighDynamicRange().catch(() => false),
      audio ? audio.computePacketStats().catch(() => null) : Promise.resolve(null),
    ]);
    if (!(duration > 0)) throw new Error("This video has no playable frames.");
    let poster: string | null = null;
    try {
      const sink = new CanvasSink(video, { width: 192, poolSize: 1 });
      const first = await video.getFirstTimestamp();
      const frame = await sink.getCanvas(first + Math.min(1, duration * 0.1));
      if (frame && frame.canvas instanceof HTMLCanvasElement) poster = frame.canvas.toDataURL("image/jpeg", 0.75);
    } catch {
      // The poster is only decoration.
    }
    return {
      size: file.size,
      duration,
      width: video.displayWidth,
      height: video.displayHeight,
      fps: finite(stats.averagePacketRate),
      codec: video.codec,
      videoBitrate: finite(stats.averageBitrate),
      audio: audio ? { codec: audio.codec, bitrate: finite(aStats?.averageBitrate), channels: audio.numberOfChannels, sampleRate: audio.sampleRate } : null,
      hdr,
      poster,
    };
  } finally {
    input.dispose();
  }
}

/* ---------------- planning ---------------- */

type AudioPlan = { mode: "drop" } | { mode: "copy"; bitrate: number } | { mode: "encode"; codec: AudioCodec; bitrate: number; channels: number; sampleRate: number };

export interface CompressPlan {
  codec: CodecId;
  container: "mp4" | "webm";
  width: number;
  height: number;
  /** False when the original frame size is kept: frames then go straight from decoder to encoder. */
  resize: boolean;
  /** Constant-quality level, or null in target-size mode. */
  quality: number | null;
  /** Video bitrate in target-size mode. */
  videoBitrate: number | null;
  targetBytes: number | null;
  audio: AudioPlan;
}

export type PlanOutcome = { ok: true; plan: CompressPlan } | { ok: false; reason: string };

const outputFormat = (container: "mp4" | "webm") => (container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat());

async function planAudio(p: VideoProbe, s: CompressSettings, container: "mp4" | "webm", budgetKbps: number | null): Promise<AudioPlan> {
  if (!s.keepAudio || !p.audio) return { mode: "drop" };
  const src = p.audio.codec ?? "";
  const srcKbps = (p.audio.bitrate ?? 0) / 1000;
  const fits = (outputFormat(container).getSupportedAudioCodecs() as string[]).includes(src);
  // Copy compressed audio untouched unless it would blow a tight size budget.
  if (COPYABLE_AUDIO.has(src) && fits && srcKbps > 0 && srcKbps <= 320 && (budgetKbps === null || srcKbps <= budgetKbps)) {
    return { mode: "copy", bitrate: srcKbps * 1000 };
  }
  const kbps = Math.round(Math.min(budgetKbps ?? AUDIO_KBPS[s.goal], AUDIO_KBPS[s.goal]));
  const channels = Math.min(2, Math.max(1, p.audio.channels));
  for (const codec of (container === "mp4" ? ["aac", "opus"] : ["opus", "vorbis"]) as AudioCodec[]) {
    const sampleRate = codec === "opus" ? 48000 : [44100, 48000].includes(p.audio.sampleRate) ? p.audio.sampleRate : 48000;
    if (await canEncodeAudio(codec, { numberOfChannels: channels, sampleRate, quality: new Quality({ bitrate: kbps * 1000 }) }).catch(() => false)) {
      return { mode: "encode", codec, bitrate: kbps * 1000, channels, sampleRate };
    }
  }
  throw new Error(`This browser cannot encode audio for ${container.toUpperCase()}. Turn off "Keep audio" to compress the video alone.`);
}

/** Lowest sensible bitrate for a frame size, used to pick a resolution that a size budget can afford. */
const floorBitrate = (codec: CodecId, w: number, h: number, fps: number | null) => 0.04 * w * h * Math.min(fps ?? 30, 30) * EFFICIENCY[codec];

export async function planCompression(p: VideoProbe, s: CompressSettings): Promise<PlanOutcome> {
  const codec = CODECS.find((c) => c.id === s.codec)!;
  const short = Math.min(p.width, p.height);
  const sizeFor = (edge: number) => {
    const k = Math.min(1, edge / short);
    return { width: even(p.width * k), height: even(p.height * k) };
  };
  let edge = s.maxEdge && s.maxEdge < short ? s.maxEdge : short;
  let targetBytes: number | null = null;
  let videoBitrate: number | null = null;
  let audio: AudioPlan;

  if (s.goal === "size") {
    targetBytes = Math.round(s.targetMB * 1_000_000);
    if (p.size <= targetBytes) return { ok: false, reason: `Already under ${s.targetMB} MB, so nothing needs to change.` };
    const budget = (targetBytes * 8 * 0.985) / p.duration; // keep 1.5% for container overhead
    audio = await planAudio(p, s, codec.container, Math.max(64, (budget * 0.15) / 1000));
    const audioBits = audio.mode === "drop" ? 0 : audio.bitrate;
    videoBitrate = Math.floor(budget - audioBits);
    if (videoBitrate < 150_000) {
      const needMB = Math.ceil(((150_000 + audioBits) * p.duration) / 8 / 0.985 / 1_000_000);
      return { ok: false, reason: `${s.targetMB} MB is too small for ${Math.round(p.duration)} s of video. Try at least ${needMB} MB, or turn off audio.` };
    }
    if (!s.maxEdge) {
      // Pick the largest standard size the budget can afford instead of starving every frame.
      const options = [short, 1080, 720, 540, 480, 360].filter((e) => e <= short);
      edge = options.find((e) => { const d = sizeFor(e); return videoBitrate! >= floorBitrate(s.codec, d.width, d.height, p.fps); }) ?? options[options.length - 1];
    }
  } else {
    audio = await planAudio(p, s, codec.container, null);
  }

  const { width, height } = sizeFor(edge);
  const resize = width !== p.width || height !== p.height;
  const quality = s.goal === "size" ? null : GOAL_QUALITY[s.goal];
  const check = quality === null ? new Quality({ bitrate: videoBitrate! }) : new Quality({ quality });
  if (!(await canEncodeVideo(s.codec, { width, height, quality: check, frameRate: p.fps ?? undefined }).catch(() => false))) {
    return { ok: false, reason: `This browser cannot encode ${codec.label.split(" ·")[0]} at ${width}×${height}. Pick another format or a smaller resolution.` };
  }
  return { ok: true, plan: { codec: s.codec, container: codec.container, width, height, resize, quality, videoBitrate, targetBytes, audio } };
}

/** Which codecs this browser can encode at all (checked at 1080p, falling back to 720p). */
export async function encodableCodecs(): Promise<CodecId[]> {
  const out: CodecId[] = [];
  for (const c of CODECS) {
    const ok = (await canEncodeVideo(c.id, { width: 1920, height: 1080 }).catch(() => false)) || (await canEncodeVideo(c.id, { width: 1280, height: 720 }).catch(() => false));
    if (ok) out.push(c.id);
  }
  return out;
}

/* ---------------- encoding ---------------- */

export interface CompressResult {
  blob: Blob;
  extension: string;
  width: number;
  height: number;
  audio: "copied" | "re-encoded" | "none";
  /** Set when audio was wanted but could not be kept. */
  audioNote?: string;
  passes: number;
  /** Target-size mode only: the result is still above the target after the corrective pass. */
  overTarget: boolean;
  /** Encoding time in seconds, all passes included. */
  seconds: number;
}

const DISCARD_REASON: Record<DiscardedTrack["reason"], string> = {
  discarded_by_user: "it was switched off",
  max_track_count_reached: "the output format has no room for it",
  max_track_count_of_type_reached: "the output format has no room for it",
  unknown_source_codec: "its codec is not recognised",
  undecodable_source_codec: "this browser cannot decode it",
  no_encodable_target_codec: "this browser cannot encode it for the chosen format",
  cannot_copy: "it could not be copied",
  unknown_maximum_packet_count: "its length could not be determined",
};

async function encodeOnce(file: Blob, duration: number, plan: CompressPlan, videoBitrate: number | null, onProgress: (f: number) => void, signal: AbortSignal) {
  const input = openInput(file);
  const format = outputFormat(plan.container);
  const target = new BufferTarget();
  const output = new Output({ format, target });
  try {
    // The conversion measures progress against each track's declared duration. Chrome's
    // MediaRecorder writes MP4s that declare a fraction of a second, which would pin the bar at
    // 100% almost at once, so a clearly short declaration is replaced with the track's real length.
    for (const track of await input.getTracks()) {
      const declared = await track.getDurationFromMetadata().catch(() => null);
      if (declared !== null && declared < duration * 0.9) {
        const real = await track.computeDuration();
        track.getDurationFromMetadata = async () => real;
      }
    }
    const video: ConversionVideoOptions = {
      codec: plan.codec,
      forceTranscode: true,
      quality: videoBitrate !== null ? new Quality({ bitrate: videoBitrate, bitrateMode: "variable" }) : new Quality({ quality: plan.quality! }),
      ...(plan.resize ? { width: plan.width, height: plan.height, fit: "fill" as const } : {}),
    };
    const a = plan.audio;
    const audio: ConversionAudioOptions =
      a.mode === "drop" ? { discard: true } : a.mode === "copy" ? {} : { codec: a.codec, quality: new Quality({ bitrate: a.bitrate }), numberOfChannels: a.channels, sampleRate: a.sampleRate, forceTranscode: true };
    const conversion = await Conversion.init({ input, output, tracks: "primary", video, audio });
    const videoOut = conversion.utilizedTracks.some((t) => t.isVideoTrack());
    if (!conversion.isValid || !videoOut) {
      const why = conversion.discardedTracks.find((d) => d.track.isVideoTrack());
      throw new Error(`The video cannot be compressed here: ${why ? DISCARD_REASON[why.reason] : "the conversion is not supported"}.`);
    }
    const lostAudio = a.mode !== "drop" ? conversion.discardedTracks.find((d) => d.track.isAudioTrack()) : undefined;
    conversion.onProgress = (f) => onProgress(Math.min(1, f));
    const cancel = () => void conversion.cancel();
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    signal.addEventListener("abort", cancel);
    try {
      await conversion.execute();
    } catch (e) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      throw e;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
    if (!target.buffer) throw new Error("The encoder produced no output.");
    return {
      blob: new Blob([target.buffer], { type: format.mimeType }),
      extension: format.fileExtension,
      audio: (a.mode === "drop" || lostAudio ? "none" : a.mode === "copy" ? "copied" : "re-encoded") as CompressResult["audio"],
      audioNote: lostAudio ? `Audio was left out because ${DISCARD_REASON[lostAudio.reason]}.` : undefined,
    };
  } finally {
    input.dispose();
  }
}

/** Runs the plan. In target-size mode a second pass corrects the bitrate if the first one overshoots. */
export async function compressVideo(file: Blob, p: VideoProbe, plan: CompressPlan, onProgress: (stage: string, f: number) => void, signal: AbortSignal): Promise<CompressResult> {
  const started = performance.now();
  let bitrate = plan.videoBitrate;
  let r = await encodeOnce(file, p.duration, plan, bitrate, (f) => onProgress("Compressing", f), signal);
  let passes = 1;
  if (plan.targetBytes && bitrate && r.blob.size > plan.targetBytes) {
    const audioBits = plan.audio.mode === "drop" ? 0 : plan.audio.bitrate * p.duration;
    const scale = (plan.targetBytes * 8 * 0.985 - audioBits) / Math.max(1, r.blob.size * 8 - audioBits);
    bitrate = Math.max(100_000, Math.floor(bitrate * Math.min(0.97, scale * 0.97)));
    r = await encodeOnce(file, p.duration, plan, bitrate, (f) => onProgress("Second pass to fit the target", f), signal);
    passes = 2;
  }
  return { ...r, width: plan.width, height: plan.height, passes, overTarget: !!plan.targetBytes && r.blob.size > plan.targetBytes, seconds: (performance.now() - started) / 1000 };
}

/* ---------------- quality check ---------------- */

export interface QualityReport {
  /** Mean SSIM over the sampled frames (1 = identical). */
  mean: number;
  /** Lowest single-frame SSIM. */
  min: number;
  samples: number;
  /** Size of the compared region at output resolution. */
  region: { w: number; h: number };
}

/**
 * Mean structural similarity of two equally sized RGBA images, on luma, with 8×8 windows every
 * 4 px (Wang et al. 2004 with a box window instead of a Gaussian).
 */
export function ssim(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): number {
  const n = w * h;
  const ya = new Float32Array(n), yb = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    ya[i] = 0.299 * a[j] + 0.587 * a[j + 1] + 0.114 * a[j + 2];
    yb[i] = 0.299 * b[j] + 0.587 * b[j + 1] + 0.114 * b[j + 2];
  }
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, W = 8, N = W * W;
  let sum = 0, count = 0;
  for (let y = 0; y + W <= h; y += 4)
    for (let x = 0; x + W <= w; x += 4) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let yy = y; yy < y + W; yy++)
        for (let i = yy * w + x, end = i + W; i < end; i++) {
          const p = ya[i], q = yb[i];
          sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q;
        }
      const ma = sa / N, mb = sb / N;
      const va = saa / N - ma * ma, vb = sbb / N - mb * mb, cov = sab / N - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  return count ? sum / count : 1;
}

/**
 * Reads a region of a decoded frame. The frame is copied into `scratch`, a canvas kept in CPU
 * memory (willReadFrequently), because reading pixels back from the decoder's GPU canvas on every
 * sample is slow and makes the browser warn.
 */
function regionPixels(scratch: CanvasRenderingContext2D, frame: HTMLCanvasElement | OffscreenCanvas, x: number, y: number, w: number, h: number) {
  scratch.drawImage(frame, x, y, w, h, 0, 0, w, h);
  return scratch.getImageData(0, 0, w, h).data;
}

/**
 * Compares the compressed file with the original on frames spread across the video, at the
 * output's resolution, on a centre region of up to 1920×1080 at full detail (no downscaling,
 * which would hide compression artefacts).
 */
export async function measureQuality(original: Blob, compressed: Blob, signal: AbortSignal, onProgress?: (f: number) => void): Promise<QualityReport> {
  const a = openInput(original), b = openInput(compressed);
  try {
    const [va, vb] = await Promise.all([a.getPrimaryVideoTrack(), b.getPrimaryVideoTrack()]);
    if (!va || !vb) throw new Error("The videos could not be read back for the quality check.");
    const w = vb.displayWidth, h = vb.displayHeight;
    const same = va.displayWidth === w && va.displayHeight === h;
    const sinkA = new CanvasSink(va, same ? { poolSize: 1 } : { width: w, height: h, fit: "fill", poolSize: 1 });
    const sinkB = new CanvasSink(vb, { poolSize: 1 });
    const [fa, fb, dur] = await Promise.all([va.getFirstTimestamp(), vb.getFirstTimestamp(), vb.computeDuration()]);
    const span = Math.max(0, dur - fb);
    const n = span < 1 ? 1 : 6;
    const rw = Math.min(w, 1920), rh = Math.min(h, 1080);
    const x0 = Math.floor((w - rw) / 2), y0 = Math.floor((h - rh) / 2);
    const scratch = makeCanvas(rw, rh).getContext("2d", { willReadFrequently: true });
    if (!scratch) throw new Error("This browser could not create a canvas for the quality check.");
    const scores: number[] = [];
    for (let i = 0; i < n; i++) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const off = (span * (i + 0.5)) / n;
      const fA = await sinkA.getCanvas(fa + off);
      const pa = fA && regionPixels(scratch, fA.canvas, x0, y0, rw, rh);
      const fB = await sinkB.getCanvas(fb + off);
      const pb = fB && regionPixels(scratch, fB.canvas, x0, y0, rw, rh);
      if (pa && pb) scores.push(ssim(pa, pb, rw, rh));
      onProgress?.((i + 1) / n);
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between frames
    }
    if (!scores.length) throw new Error("No frames could be compared.");
    return { mean: scores.reduce((s, v) => s + v, 0) / scores.length, min: Math.min(...scores), samples: scores.length, region: { w: rw, h: rh } };
  } finally {
    a.dispose();
    b.dispose();
  }
}

/** Plain-language reading of an SSIM score. A rule of thumb, not a guarantee: the comparison view is the final judge. */
export function verdict(score: number): { label: string; tone: "good" | "warn" | "bad" } {
  if (score >= 0.98) return { label: "No visible difference expected", tone: "good" };
  if (score >= 0.95) return { label: "Very close: differences only up close", tone: "good" };
  if (score >= 0.9) return { label: "Some softening visible up close", tone: "warn" };
  return { label: "Visible quality loss", tone: "bad" };
}
