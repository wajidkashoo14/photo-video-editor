"use client";

import { Copy, Eye, EyeOff, Lock, Magnet, Minus, Plus, Scissors, Trash2, Unlock, Volume2, VolumeX } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton, Select, toast } from "@/components/ui";
import { clamp, cn, formatTime } from "@/lib/utils";
import { clipEnd, projectDuration, trackKindFor, type Clip, type MediaAsset, type Track, type TrackKind } from "@/lib/video/types";
import { freeStart, useVideo } from "@/stores/videoStore";

const HEADER_W = 176;
const RULER_H = 26;
const ROW_H: Record<TrackKind, number> = { video: 58, audio: 46, text: 34 };
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const CLIP_STYLE: Record<Clip["type"], string> = {
  video: "bg-[#3b3470] border-[#7c6cff]",
  image: "bg-[#1f4d4a] border-[#3fb8ac]",
  audio: "bg-[#1f4a33] border-[#3fbf7f]",
  text: "bg-[#5a4317] border-[#e0a83c]",
};

/* ---------- waveform ---------- */
function Waveform({ asset, clip, width, height }: { asset: MediaAsset; clip: Clip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !asset.peaks || !asset.peaksPerSec) return;
    const w = Math.min(4096, Math.max(1, Math.round(width)));
    c.width = w;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      const t0 = clip.offset + (x / w) * clip.duration * clip.speed;
      const t1 = clip.offset + ((x + 1) / w) * clip.duration * clip.speed;
      const i0 = Math.floor(t0 * asset.peaksPerSec), i1 = Math.max(i0 + 1, Math.ceil(t1 * asset.peaksPerSec));
      let v = 0;
      for (let i = i0; i < i1 && i < asset.peaks.length; i++) v = Math.max(v, asset.peaks[i] ?? 0);
      const h = Math.max(1, v * clip.volume * (height - 4));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [asset.peaks, asset.peaksPerSec, clip.offset, clip.duration, clip.speed, clip.volume, width, height]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 w-full" style={{ height }} />;
}

/* ---------- clip ---------- */
type DragMode = "move" | "trim-l" | "trim-r";

const ClipView = memo(function ClipView({ clip, asset, pps, selected, locked, rowH, onDragStart }: {
  clip: Clip; asset?: MediaAsset; pps: number; selected: boolean; locked: boolean; rowH: number;
  onDragStart: (e: React.PointerEvent, clip: Clip, mode: DragMode) => void;
}) {
  const w = Math.max(2, clip.duration * pps);
  const strip = clip.type === "video" ? asset?.strip : undefined;
  const tiles = Math.min(60, Math.ceil(w / ((rowH - 10) * 1.6)));
  return (
    <div
      role="button"
      aria-label={`Clip ${clip.name}`}
      aria-pressed={selected}
      onPointerDown={(e) => onDragStart(e, clip, "move")}
      className={cn("absolute top-1 overflow-hidden rounded-md border text-[11px] text-white/90", CLIP_STYLE[clip.type], selected ? "ring-2 ring-white" : "border-opacity-60", locked ? "opacity-60" : "cursor-grab")}
      style={{ left: clip.start * pps, width: w, height: rowH - 8 }}
    >
      {strip && strip.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex opacity-70">
          {Array.from({ length: tiles }, (_, i) => {
            // Pick the filmstrip frame nearest to this tile's source time.
            const srcT = clip.offset + ((i + 0.5) / tiles) * clip.duration * clip.speed;
            const idx = clamp(Math.floor((srcT / (asset?.duration || 1)) * strip.length), 0, strip.length - 1);
            return <span key={i} className="h-full flex-1 bg-cover bg-center" style={{ backgroundImage: `url(${strip[idx]})` }} />;
          })}
        </div>
      )}
      {clip.type === "image" && asset?.thumb && <div className="pointer-events-none absolute inset-0 bg-repeat-x opacity-60" style={{ backgroundImage: `url(${asset.thumb})`, backgroundSize: "auto 100%" }} />}
      {asset?.peaks && (clip.type === "audio" || clip.type === "video") && w > 6 && <Waveform asset={asset} clip={clip} width={w} height={clip.type === "audio" ? rowH - 22 : 16} />}
      <span className="pointer-events-none relative block truncate bg-black/35 px-1.5 py-0.5 leading-tight">
        {clip.name}
        {clip.speed !== 1 && <span className="ml-1 opacity-70">{clip.speed}×</span>}
      </span>
      {clip.transIn.type !== "none" && <span className="pointer-events-none absolute bottom-0 left-0 top-0 bg-gradient-to-r from-white/45 to-transparent" style={{ width: Math.min(w, clip.transIn.duration * pps) }} />}
      {clip.transOut.type !== "none" && <span className="pointer-events-none absolute bottom-0 right-0 top-0 bg-gradient-to-l from-white/45 to-transparent" style={{ width: Math.min(w, clip.transOut.duration * pps) }} />}
      {!locked && (
        <>
          <span className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/70" onPointerDown={(e) => onDragStart(e, clip, "trim-l")} />
          <span className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/70" onPointerDown={(e) => onDragStart(e, clip, "trim-r")} />
        </>
      )}
    </div>
  );
});

/* ---------- track header ---------- */
function TrackHeader({ track, canDelete }: { track: Track; canDelete: boolean }) {
  const { updateTrack, removeTrack } = useVideo.getState();
  return (
    <div className="sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-b border-r border-line bg-panel px-2" style={{ width: HEADER_W, height: ROW_H[track.kind] }}>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{track.name}</span>
      <IconButton className="h-6 w-6" label={track.locked ? "Unlock track" : "Lock track"} active={track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })}>
        {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </IconButton>
      {track.kind !== "audio" && (
        <IconButton className="h-6 w-6" label={track.hidden ? "Show track" : "Hide track"} active={track.hidden} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>
          {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </IconButton>
      )}
      {track.kind !== "text" && (
        <IconButton className="h-6 w-6" label={track.muted ? "Unmute track" : "Mute track"} active={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>
          {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </IconButton>
      )}
      {canDelete && (
        <IconButton className="h-6 w-6" label="Delete track" onClick={() => removeTrack(track.id)}>
          <Trash2 size={12} />
        </IconButton>
      )}
    </div>
  );
}

/* ---------- timeline ---------- */
export function Timeline() {
  const project = useVideo((s) => s.project);
  const assets = useVideo((s) => s.assets);
  const selectedId = useVideo((s) => s.selectedId);
  const pps = useVideo((s) => s.pxPerSec);
  const snapping = useVideo((s) => s.snapping);
  const time = useVideo((s) => s.time);
  const playing = useVideo((s) => s.playing);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const duration = projectDuration(project);
  const laneW = Math.max((duration + 20) * pps, view.width);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setView((v) => (Math.abs(v.left - el.scrollLeft) < 1 && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, [measure]);

  // Follow the playhead during playback.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = time * pps;
    if (x > el.scrollLeft + el.clientWidth - HEADER_W - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [time, playing, pps]);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft - HEADER_W) / pps);
  };

  const scrub = (e: React.PointerEvent) => {
    const fps = useVideo.getState().project.fps;
    const seek = (x: number) => useVideo.getState().set({ time: Math.round(timeAt(x) * fps) / fps, playing: false });
    seek(e.clientX);
    const mv = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  const startDrag = useCallback((e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const S = useVideo.getState;
    S().set({ selectedId: clip.id });
    const track = S().project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const pps0 = S().pxPerSec;
    const asset = S().assets[clip.assetId ?? ""];
    const timed = clip.type === "video" || clip.type === "audio";
    const minLen = 1 / S().project.fps;

    const snap = (t: number, p = S().project) => {
      if (!S().snapping) return t;
      const tol = 8 / pps0;
      let best = t, d = tol;
      const pts = [0, S().time, ...p.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, clipEnd(c)])];
      for (const pt of pts) if (Math.abs(pt - t) < d) { d = Math.abs(pt - t); best = pt; }
      return best;
    };

    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / pps0;
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        S().snapshot();
      }
      const p = S().project;
      const siblings = p.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id);
      if (mode === "move") {
        let start = Math.max(0, clip.start + dx);
        const s1 = snap(start), s2 = snap(start + clip.duration) - clip.duration;
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2;
        // Switch track when the pointer is over another unlocked track of the same kind.
        let trackId = clip.trackId;
        const under = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-track]");
        const target = p.tracks.find((t) => t.id === under?.dataset.track);
        if (target && !target.locked && target.kind === trackKindFor(clip.type)) trackId = target.id;
        start = freeStart(p, trackId, Math.max(0, start), clip.duration, clip.id);
        S().updateClip(clip.id, { start, trackId }, false);
      } else if (mode === "trim-l") {
        const prevEnd = Math.max(0, ...siblings.filter((c) => clipEnd(c) <= clip.start + 1e-6).map(clipEnd));
        const lo = Math.max(prevEnd, timed ? clip.start - clip.offset / clip.speed : 0);
        const start = clamp(snap(clip.start + dx), lo, clipEnd(clip) - minLen);
        S().updateClip(clip.id, { start, duration: clipEnd(clip) - start, offset: timed ? Math.max(0, clip.offset + (start - clip.start) * clip.speed) : 0 }, false);
      } else {
        const nextStart = Math.min(Infinity, ...siblings.filter((c) => c.start >= clipEnd(clip) - 1e-6).map((c) => c.start));
        const hi = Math.min(nextStart, timed && asset ? clip.start + (asset.duration - clip.offset) / clip.speed : Infinity);
        const end = clamp(snap(clipEnd(clip) + dx), clip.start + minLen, hi);
        S().updateClip(clip.id, { duration: end - clip.start }, false);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }, []);

  const drop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    const asset = useVideo.getState().assets[e.dataTransfer.getData("text/cs-asset")];
    if (!asset) return;
    const fits = track.kind === trackKindFor(asset.kind) && !track.locked;
    const clip = useVideo.getState().addAssetClip(asset, timeAt(e.clientX), fits ? track.id : undefined);
    if (!clip) toast(`Add an unlocked ${trackKindFor(asset.kind)} track first.`, "error");
  };

  // Ruler ticks, virtualised to the visible range.
  const step = STEPS.find((s) => s * pps >= 72) ?? 600;
  const first = Math.floor(Math.max(0, view.left - HEADER_W) / pps / step);
  const last = Math.ceil((view.left + view.width) / pps / step);
  const ticks = Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
  const visFrom = (view.left - 300) / pps, visTo = (view.left + view.width + 300) / pps;
  const sel = project.clips.find((c) => c.id === selectedId);
  const { set, split, removeClip, duplicateClip, addTrack } = useVideo.getState();
  const counts = { video: 0, audio: 0, text: 0 } as Record<TrackKind, number>;
  project.tracks.forEach((t) => counts[t.kind]++);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton label="Split at playhead (S)" onClick={() => !split() && toast("Move the playhead inside a clip to split it.")}><Scissors size={15} /></IconButton>
        <IconButton label="Duplicate clip (Ctrl+D)" disabled={!sel} onClick={() => sel && duplicateClip(sel.id)}><Copy size={15} /></IconButton>
        <IconButton label="Delete clip (Del)" disabled={!sel} onClick={() => sel && removeClip(sel.id)}><Trash2 size={15} /></IconButton>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label={snapping ? "Snapping on" : "Snapping off"} active={snapping} onClick={() => set({ snapping: !snapping })}><Magnet size={15} /></IconButton>
        <Select<string> label="Add track" className="w-28" value="" onChange={(v) => v && addTrack(v as TrackKind)} options={[{ value: "", label: "Add track" }, { value: "video", label: "Video track" }, { value: "audio", label: "Audio track" }, { value: "text", label: "Text track" }]} />
        <div className="flex-1" />
        <span className="mr-2 font-mono text-[11px] text-muted">{formatTime(time, project.fps)} / {formatTime(duration, project.fps)}</span>
        <IconButton label="Zoom timeline out" onClick={() => set({ pxPerSec: clamp(pps / 1.4, 4, 800) })}><Minus size={15} /></IconButton>
        <input type="range" aria-label="Timeline zoom" className="cs-range w-28" style={{ "--fill": `${(Math.log(pps / 4) / Math.log(200)) * 100}%` } as React.CSSProperties} min={0} max={1} step={0.01} value={Math.log(pps / 4) / Math.log(200)} onChange={(e) => set({ pxPerSec: 4 * Math.pow(200, Number(e.target.value)) })} />
        <IconButton label="Zoom timeline in" onClick={() => set({ pxPerSec: clamp(pps * 1.4, 4, 800) })}><Plus size={15} /></IconButton>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onScroll={measure}>
        <div className="relative" style={{ width: HEADER_W + laneW, minHeight: "100%" }}>
          {/* ruler */}
          <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-30 shrink-0 border-b border-r border-line bg-panel" style={{ width: HEADER_W }} />
            <div className="relative flex-1 cursor-pointer border-b border-line bg-panel-2" onPointerDown={scrub}>
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 h-full border-l border-line pl-1 font-mono text-[10px] leading-[26px] text-muted" style={{ left: t * pps }}>
                  {step < 1 ? t.toFixed(2) : formatTime(t, project.fps).slice(0, 5)}
                </span>
              ))}
              <span className="pointer-events-none absolute bottom-0 h-3 w-[11px] -translate-x-[5px] rounded-t-sm bg-[#ff4d6d]" style={{ left: time * pps }} />
            </div>
          </div>
          {/* tracks */}
          {project.tracks.map((track) => (
            <div key={track.id} className="flex">
              <TrackHeader track={track} canDelete={counts[track.kind] > 1} />
              <div
                data-track={track.id}
                className={cn("relative flex-1 border-b border-line", track.hidden && "opacity-40", track.locked && "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(255,255,255,0.03)_6px,rgba(255,255,255,0.03)_12px)]")}
                style={{ height: ROW_H[track.kind] }}
                onPointerDown={(e) => { if (e.target === e.currentTarget) { set({ selectedId: null }); scrub(e); } }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, track)}
              >
                {project.clips.filter((c) => c.trackId === track.id && clipEnd(c) >= visFrom && c.start <= visTo).map((c) => (
                  <ClipView key={c.id} clip={c} asset={assets[c.assetId ?? ""]} pps={pps} selected={c.id === selectedId} locked={track.locked} rowH={ROW_H[track.kind]} onDragStart={startDrag} />
                ))}
              </div>
            </div>
          ))}
          {/* playhead */}
          {time * pps >= view.left - 1 && <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-[#ff4d6d]" style={{ left: HEADER_W + time * pps }} />}
        </div>
      </div>
    </div>
  );
}
