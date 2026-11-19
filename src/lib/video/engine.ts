import { isDefaultAdj } from "@/lib/adjustments";
import { getAdjustRenderer, type Lut3D } from "@/lib/gl/adjust";
import { drawText } from "@/lib/text";
import { clamp } from "@/lib/utils";
import { clipEnd, type Clip, type Transition, type VideoProject } from "./types";

/** A drawable frame for a clip plus its natural size. */
export interface Frame { source: CanvasImageSource; width: number; height: number; stream: boolean }
/** Supplies the frame of `clip` at `srcTime` seconds into its source media (null while loading). */
export type FrameProvider = (clip: Clip, srcTime: number) => Frame | null;

const ease = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** Source-media time for a clip at timeline time `t`. */
export const sourceTime = (c: Clip, t: number) => c.offset + (t - c.start) * c.speed;

/** Clips to draw at `t`, back to front, including the outgoing clip of a cross dissolve. */
export function visibleClips(p: VideoProject, t: number): { clip: Clip; tail: boolean }[] {
  const out: { clip: Clip; tail: boolean }[] = [];
  const frame = 1 / p.fps;
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const tr = p.tracks[i];
    if (tr.hidden || tr.kind === "audio") continue;
    const clips = p.clips.filter((c) => c.trackId === tr.id);
    for (const c of clips) {
      if (t < c.start || t >= clipEnd(c)) continue;
      if (c.transIn.type === "dissolve" && t < c.start + c.transIn.duration) {
        // Keep the previous clip on this track alive underneath while the new one fades in.
        const prev = clips.find((o) => o !== c && Math.abs(clipEnd(o) - c.start) < frame * 1.5);
        if (prev) out.push({ clip: prev, tail: true });
      }
      out.push({ clip: c, tail: false });
    }
  }
  return out;
}

interface Fx { alpha: number; dx: number; dy: number; scale: number; wipe: number; blur: number }

function applyTransition(fx: Fx, tr: Transition, p: number, W: number, H: number, out: boolean) {
  if (tr.type === "none" || p >= 1) return;
  const e = ease(p), dir = out ? -1 : 1;
  switch (tr.type) {
    case "fade":
    case "dissolve": fx.alpha *= e; break;
    case "slide-left": fx.dx += (1 - e) * W * dir; break;
    case "slide-right": fx.dx -= (1 - e) * W * dir; break;
    case "slide-up": fx.dy += (1 - e) * H * dir; break;
    case "slide-down": fx.dy -= (1 - e) * H * dir; break;
    case "zoom": fx.scale *= 0.6 + 0.4 * e; fx.alpha *= e; break;
    case "wipe": fx.wipe = Math.min(fx.wipe, e); break;
    case "blur": fx.blur = Math.max(fx.blur, (1 - e) * 24); fx.alpha *= e; break;
  }
}

export interface DrawOpts { luts: Map<string, Lut3D>; background?: string }

/**
 * Composites one frame of the project in project-pixel coordinates. The caller scales the
 * context for preview or export, so both paths share exactly the same rendering.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, p: VideoProject, t: number, frames: FrameProvider, o: DrawOpts) {
  const W = p.width, H = p.height;
  ctx.fillStyle = o.background ?? "#000";
  ctx.fillRect(0, 0, W, H);
  for (const { clip: c, tail } of visibleClips(p, t)) {
    const local = t - c.start;
    const fx: Fx = { alpha: c.opacity, dx: 0, dy: 0, scale: 1, wipe: 1, blur: 0 };
    if (!tail) {
      if (c.transIn.duration > 0) applyTransition(fx, c.transIn, local / c.transIn.duration, W, H, false);
      if (c.transOut.duration > 0) applyTransition(fx, c.transOut, (c.duration - local) / c.transOut.duration, W, H, true);
    }
    let reveal = 1;
    if (c.type === "text" && c.anim !== "none") {
      const a = ease(local / 0.5);
      if (c.anim === "fade") fx.alpha *= a;
      else if (c.anim === "slide-up") { fx.dy += (1 - a) * H * 0.08; fx.alpha *= a; }
      else if (c.anim === "pop") { fx.scale *= 0.5 + 0.5 * a + Math.sin(a * Math.PI) * 0.08; fx.alpha *= a; }
      else if (c.anim === "typewriter") reveal = clamp(local / Math.min(c.duration * 0.6, Math.max(0.4, (c.style?.text.length ?? 1) * 0.05)), 0, 1);
    }
    if (fx.alpha <= 0.001) continue;
    ctx.save();
    if (fx.wipe < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, W * fx.wipe, H);
      ctx.clip();
    }
    if (fx.blur > 0.2) ctx.filter = `blur(${fx.blur * ctx.getTransform().a}px)`;
    ctx.globalAlpha = clamp(fx.alpha, 0, 1);
    ctx.translate(W / 2 + c.x + fx.dx, H / 2 + c.y + fx.dy);
    ctx.rotate((c.rotation * Math.PI) / 180);
    const s = c.scale * fx.scale;
    if (c.type === "text") {
      if (c.style) {
        ctx.scale(s, s);
        drawText(ctx, c.style, reveal);
      }
    } else {
      const f = frames(c, sourceTime(c, t));
      if (f && f.width && f.height) {
        const cw = 1 - c.crop.l - c.crop.r, ch = 1 - c.crop.t - c.crop.b;
        const vw = f.width * cw, vh = f.height * ch;
        const fit = Math.min(W / vw, H / vh) * s;
        const dw = vw * fit, dh = vh * fit;
        let src: CanvasImageSource = f.source, sw = f.width, sh = f.height;
        const lut = c.lutId ? o.luts.get(c.lutId) : null;
        if (!isDefaultAdj(c.adjustments) || c.filter.id || lut) {
          // Grade at no more than the size it will be shown at.
          const k = Math.min(1, Math.max(dw / vw, dh / vh) * ctx.getTransform().a);
          sw = Math.max(2, Math.round(f.width * k));
          sh = Math.max(2, Math.round(f.height * k));
          src = getAdjustRenderer().render(f.source as TexImageSource & object, sw, sh, c.adjustments, { filter: c.filter, lut, lutMix: c.lutMix, stream: f.stream, seed: Math.floor(t * p.fps) });
        }
        if (c.flipX) ctx.scale(-1, 1);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, c.crop.l * sw, c.crop.t * sh, cw * sw, ch * sh, -dw / 2, -dh / 2, dw, dh);
      }
    }
    ctx.restore();
  }
}

/** Volume envelope (0..1) for a clip at timeline time `t`, including audio fades. */
export function clipGain(c: Clip, t: number): number {
  const local = t - c.start;
  let g = c.volume;
  if (c.fadeIn > 0) g *= clamp(local / c.fadeIn, 0, 1);
  if (c.fadeOut > 0) g *= clamp((c.duration - local) / c.fadeOut, 0, 1);
  return clamp(g, 0, 1);
}

/** On-screen size of a clip (project pixels), used for the preview selection outline. */
export function clipBox(p: VideoProject, c: Clip, natural: { width: number; height: number } | null) {
  if (!natural || !natural.width) return null;
  const vw = natural.width * (c.type === "text" ? 1 : 1 - c.crop.l - c.crop.r);
  const vh = natural.height * (c.type === "text" ? 1 : 1 - c.crop.t - c.crop.b);
  const k = c.type === "text" ? c.scale : Math.min(p.width / vw, p.height / vh) * c.scale;
  return { w: vw * k, h: vh * k };
}
