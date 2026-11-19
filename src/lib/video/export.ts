import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, WebMOutputFormat,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type AudioCodec, type VideoCodec, type WrappedCanvas,
} from "mediabunny";
import { ensureImage } from "@/lib/assets";
import type { Lut3D } from "@/lib/gl/adjust";
import { makeCanvas } from "@/lib/utils";
import { drawFrame, visibleClips, type Frame } from "./engine";
import { clipEnd, projectDuration, type Clip, type MediaAsset, type VideoProject } from "./types";

export interface VideoExportOpts {
  format: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  /** Video bitrate, bits per second. */
  bitrate: number;
  onProgress: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult { blob: Blob; mime: string; videoCodec: string; audioCodec: string | null; frames: number }

/** Sequential decoder for one clip: frames are pulled forward as export time advances. */
class FrameCursor {
  private input: Input;
  private it: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private cur: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private done = false;

  constructor(private blob: Blob, private maxEdge: number) {
    this.input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  }

  async frameAt(ts: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
    if (!this.it) {
      const track = await this.input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error("A video clip uses a codec this browser cannot decode for export.");
      const k = Math.min(1, this.maxEdge / Math.max(track.displayWidth, track.displayHeight));
      // Width only: the sink derives the height from the track's aspect ratio.
      const sink = new CanvasSink(track, { width: Math.round(track.displayWidth * k), poolSize: 3 });
      this.it = sink.canvases(Math.max(0, ts));
      this.next = (await this.it.next()).value ?? null;
    }
    while (!this.done && this.next && this.next.timestamp <= ts + 1e-4) {
      this.cur = this.next;
      const r = await this.it.next();
      if (r.done) {
        this.done = true;
        this.next = null;
      } else this.next = r.value;
    }
    return (this.cur ?? this.next)?.canvas ?? null;
  }

  async dispose() {
    await this.it?.return();
    this.input.dispose();
  }
}

/** Mixes every audible clip into one buffer with volume, fades and speed applied. */
export async function mixAudio(p: VideoProject, assets: Record<string, MediaAsset>, duration: number, onProgress: (f: number) => void, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const muted = new Set(p.tracks.filter((t) => t.muted).map((t) => t.id));
  const clips = p.clips.filter((c) => (c.type === "video" || c.type === "audio") && !muted.has(c.trackId) && c.volume > 0 && assets[c.assetId ?? ""]?.hasAudio);
  if (!clips.length) return null;
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  let any = false;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const input = new Input({ source: new BlobSource(assets[c.assetId!].blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) continue;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const end = clipEnd(c);
      gain.gain.setValueAtTime(c.fadeIn > 0 ? 0 : c.volume, c.start);
      if (c.fadeIn > 0) gain.gain.linearRampToValueAtTime(c.volume, Math.min(end, c.start + c.fadeIn));
      if (c.fadeOut > 0) {
        gain.gain.setValueAtTime(c.volume, Math.max(c.start, end - c.fadeOut));
        gain.gain.linearRampToValueAtTime(0, end);
      }
      const srcEnd = c.offset + c.duration * c.speed;
      for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(c.offset, srcEnd)) {
        if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
        const skip = Math.max(0, c.offset - timestamp);
        const when = c.start + (timestamp + skip - c.offset) / c.speed;
        if (when >= end) break;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = c.speed;
        node.connect(gain);
        node.start(Math.max(0, when), skip);
        node.stop(end);
        any = true;
      }
    } finally {
      input.dispose();
    }
    onProgress((i + 1) / clips.length);
  }
  return any ? ctx.startRendering() : null;
}

/**
 * Renders the timeline to a file. Frames are decoded with WebCodecs, composited by the same
 * drawFrame() the preview uses, then encoded and muxed. Progress reflects real frames written.
 */
export async function exportVideo(p: VideoProject, assets: Record<string, MediaAsset>, luts: Map<string, Lut3D>, o: VideoExportOpts): Promise<VideoExportResult> {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser does not support WebCodecs, which video export requires. Use a current Chrome, Edge, Firefox or Safari.");
  const duration = projectDuration(p);
  if (duration <= 0) throw new Error("The timeline is empty.");
  const format = o.format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
  const supported = format.getSupportedCodecs();
  const videoCodec = await getFirstEncodableVideoCodec(supported.filter((c): c is VideoCodec => ["avc", "hevc", "vp9", "av1", "vp8"].includes(c)), { width: o.width, height: o.height, bitrate: o.bitrate });
  if (!videoCodec) throw new Error(`This browser cannot encode ${o.format.toUpperCase()} video at ${o.width}×${o.height}. Try a lower resolution or the other format.`);

  const canvas = makeCanvas(o.width, o.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: o.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: o.fps });

  o.onProgress("Mixing audio", 0);
  const mix = await mixAudio(p, assets, duration, (f) => o.onProgress("Mixing audio", f), o.signal);
  let audioSource: AudioBufferSource | null = null;
  let audioCodec: AudioCodec | null = null;
  if (mix) {
    audioCodec = await getFirstEncodableAudioCodec(supported.filter((c): c is AudioCodec => ["aac", "opus", "mp3", "vorbis"].includes(c)), { numberOfChannels: 2, sampleRate: mix.sampleRate });
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
  }

  const cursors = new Map<string, FrameCursor>();
  const stills = new Map<string, Frame>();
  for (const c of p.clips) {
    if (c.type !== "image" || !c.assetId || stills.has(c.assetId)) continue;
    const img = await ensureImage(c.assetId);
    if (img) stills.set(c.assetId, { source: img.full, width: img.w, height: img.h, stream: false });
  }
  const current = new Map<string, Frame>();
  const provider = (c: Clip) => (c.type === "image" ? (stills.get(c.assetId ?? "") ?? null) : (current.get(c.id) ?? null));

  await output.start();
  const total = Math.max(1, Math.round(duration * o.fps));
  try {
    if (audioSource && mix) await audioSource.add(mix);
    ctx.scale(o.width / p.width, o.height / p.height);
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = i / o.fps;
      const active = visibleClips(p, t).filter((v) => v.clip.type === "video");
      const activeIds = new Set(active.map((v) => v.clip.id));
      for (const [id, cur] of cursors) {
        if (activeIds.has(id)) continue;
        await cur.dispose();
        cursors.delete(id);
        current.delete(id);
      }
      for (const { clip } of active) {
        const asset = assets[clip.assetId ?? ""];
        if (!asset) continue;
        let cur = cursors.get(clip.id);
        if (!cur) cursors.set(clip.id, (cur = new FrameCursor(asset.blob, Math.max(o.width, o.height))));
        const src = Math.min(clip.offset + (t - clip.start) * clip.speed, Math.max(0, asset.duration - 1e-3));
        const frame = await cur.frameAt(src);
        if (frame) current.set(clip.id, { source: frame, width: frame.width, height: frame.height, stream: true });
      }
      drawFrame(ctx, p, t, provider, { luts });
      await videoSource.add(t, 1 / o.fps);
      if (i % 3 === 0) o.onProgress("Rendering video", (i + 1) / total);
    }
    o.onProgress("Finalising file", 1);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const cur of cursors.values()) await cur.dispose().catch(() => {});
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The encoder produced no output.");
  const mime = o.format === "mp4" ? "video/mp4" : "video/webm";
  return { blob: new Blob([buffer], { type: mime }), mime, videoCodec, audioCodec, frames: total };
}

/** Largest export preset the current browser can actually encode, checked before offering it. */
export async function canEncode(format: "mp4" | "webm", width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  const f = format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const codecs = f.getSupportedCodecs().filter((c): c is VideoCodec => ["avc", "hevc", "vp9", "av1", "vp8"].includes(c));
  return !!(await getFirstEncodableVideoCodec(codecs, { width, height }));
}
