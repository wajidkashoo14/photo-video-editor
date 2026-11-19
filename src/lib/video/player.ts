import { ensureImage, getImage, onAssetsChanged } from "@/lib/assets";
import { clamp } from "@/lib/utils";
import { useVideo } from "@/stores/videoStore";
import { clipGain, drawFrame, sourceTime, type Frame } from "./engine";
import { clipEnd, projectDuration, type Clip } from "./types";

/**
 * Real-time preview. Each video/audio clip near the playhead gets its own media element
 * (streamed from the stored Blob, never fully decoded into memory); a clock drives the
 * timeline and elements are kept in sync with it.
 */
export class Player {
  private els = new Map<string, HTMLMediaElement>();
  private raf = 0;
  private clock = { t0: 0, n0: 0, last: -1 };
  private wasPlaying = false;
  private unsub: (() => void)[] = [];
  private ctx: CanvasRenderingContext2D;
  /** Draws editor chrome (selection outline) on top of the frame. */
  overlay: ((ctx: CanvasRenderingContext2D, scale: number) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.unsub.push(useVideo.subscribe(() => this.request()), onAssetsChanged(() => this.request()));
    this.request();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unsub.forEach((f) => f());
    for (const el of this.els.values()) this.release(el);
    this.els.clear();
  }

  request = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  private release(el: HTMLMediaElement) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }

  private element(c: Clip): HTMLMediaElement | null {
    let el = this.els.get(c.id);
    const asset = useVideo.getState().assets[c.assetId ?? ""];
    if (!asset) return null;
    if (!el) {
      el = document.createElement(c.type === "video" ? "video" : "audio");
      el.preload = "auto";
      (el as HTMLVideoElement).playsInline = true;
      el.src = asset.url;
      el.addEventListener("seeked", this.request);
      el.addEventListener("loadeddata", this.request);
      this.els.set(c.id, el);
    }
    return el;
  }

  private sync(t: number, playing: boolean) {
    const { project, assets } = useVideo.getState();
    const tracks = new Map(project.tracks.map((tr) => [tr.id, tr]));
    const live = new Set<string>();
    for (const c of project.clips) {
      if (c.type !== "video" && c.type !== "audio") continue;
      const asset = assets[c.assetId ?? ""];
      const track = tracks.get(c.trackId);
      if (!asset || !track) continue;
      // Keep elements for clips that are active, about to start, or finishing a dissolve.
      if (t < c.start - 1.5 || t > clipEnd(c) + 1.5) continue;
      const el = this.element(c);
      if (!el) continue;
      live.add(c.id);
      const active = t >= c.start && t < clipEnd(c);
      const target = clamp(sourceTime(c, clamp(t, c.start, clipEnd(c) + 1.5)), 0, Math.max(0, asset.duration - 0.03));
      el.muted = track.muted || !asset.hasAudio;
      el.volume = active ? clipGain(c, t) : 0;
      const rate = clamp(c.speed, 0.1, 8);
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const run = playing && (active || t >= clipEnd(c));
      if (run) {
        if (el.paused) {
          el.currentTime = target;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
      }
    }
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      this.release(el);
      this.els.delete(id);
    }
  }

  private frame = (c: Clip): Frame | null => {
    if (c.type === "video") {
      const el = this.els.get(c.id) as HTMLVideoElement | undefined;
      return el && el.readyState >= 2 ? { source: el, width: el.videoWidth, height: el.videoHeight, stream: true } : null;
    }
    if (c.type === "image" && c.assetId) {
      const img = getImage(c.assetId);
      if (!img) {
        ensureImage(c.assetId);
        return null;
      }
      return { source: img.preview, width: img.preview.width, height: img.preview.height, stream: false };
    }
    return null;
  };

  private tick = () => {
    this.raf = 0;
    const s = useVideo.getState();
    let t = s.time;
    if (s.playing) {
      // (Re)base the clock when playback starts or the user seeks during playback.
      if (!this.wasPlaying || Math.abs(t - this.clock.last) > 1e-6) this.clock = { t0: t, n0: performance.now(), last: t };
      t = this.clock.t0 + (performance.now() - this.clock.n0) / 1000;
      const end = projectDuration(s.project);
      const done = t >= end;
      if (done) t = end;
      this.clock.last = t;
      useVideo.setState(done ? { time: t, playing: false } : { time: t });
    }
    this.wasPlaying = useVideo.getState().playing;
    this.sync(t, this.wasPlaying);
    this.draw(t);
    if (this.wasPlaying) this.request();
  };

  private draw(t: number) {
    const { project, luts } = useVideo.getState();
    const { canvas, ctx } = this;
    const box = canvas.parentElement;
    if (!box) return;
    const dpr = window.devicePixelRatio || 1;
    const k = Math.min(box.clientWidth / project.width, box.clientHeight / project.height);
    const cssW = Math.max(1, Math.floor(project.width * k)), cssH = Math.max(1, Math.floor(project.height * k));
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const scale = w / project.width;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawFrame(ctx, project, t, this.frame, { luts });
    this.overlay?.(ctx, scale);
  }

  /** Copies the frame a video clip is currently showing, at source resolution (freeze frame). */
  grab(clipId: string): HTMLCanvasElement | null {
    const el = this.els.get(clipId) as HTMLVideoElement | undefined;
    if (!el || !el.videoWidth || el.readyState < 2) return null;
    const c = document.createElement("canvas");
    c.width = el.videoWidth;
    c.height = el.videoHeight;
    c.getContext("2d")!.drawImage(el, 0, 0);
    return c;
  }

  /** Small JPEG of the current frame for the project thumbnail. */
  poster(): string | undefined {
    try {
      const k = 320 / this.canvas.width;
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = Math.max(1, Math.round(this.canvas.height * k));
      c.getContext("2d")!.drawImage(this.canvas, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.7);
    } catch {
      return undefined;
    }
  }
}
