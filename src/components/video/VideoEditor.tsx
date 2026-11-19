"use client";

import { Captions, ChevronFirst, ChevronLast, Clapperboard, Sparkles, Music, Pause, Play, Plus, StepBack, StepForward, Trash2, Type, Upload } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EditorTopBar } from "@/components/EditorTopBar";
import { loadBrandFonts } from "@/components/TextStyleEditor";
import { Button, IconButton, Spinner, Tabs, toast } from "@/components/ui";
import { db } from "@/lib/db";
import { createBlankProject } from "@/lib/projects";
import { measureText, type TextStyle } from "@/lib/text";
import { canvasToBlob, clamp, cn, debounce, formatBytes, formatTime, uid } from "@/lib/utils";
import { clipBox, visibleClips } from "@/lib/video/engine";
import { importMedia } from "@/lib/video/media";
import { Player } from "@/lib/video/player";
import { addSubtitleTrack, parseSubtitles, transcribeTimeline } from "@/lib/video/subtitles";
import { clipEnd, emptyVideoProject, makeClip, projectDuration, type Clip, type MediaAsset, type VideoProject } from "@/lib/video/types";
import { useVideo } from "@/stores/videoStore";
import { Inspector, VideoExportDialog } from "./Inspector";
import { Timeline } from "./Timeline";

const S = useVideo.getState;

function natural(c: Clip, assets: Record<string, MediaAsset>) {
  if (c.type === "text") {
    if (!c.style) return null;
    const m = measureText(c.style);
    return { width: m.w, height: m.h };
  }
  const a = assets[c.assetId ?? ""];
  return a ? { width: a.width, height: a.height } : null;
}

const seekFrames = (n: number) => {
  const { project, time } = S();
  S().set({ playing: false, time: clamp(Math.round(time * project.fps + n) / project.fps, 0, projectDuration(project)) });
};
const togglePlay = () => {
  const s = S();
  const end = projectDuration(s.project);
  if (end <= 0) return;
  s.set(s.playing ? { playing: false } : { playing: true, time: s.time >= end - 1e-3 ? 0 : s.time });
};

/* ---------- preview ---------- */
function Preview({ playerRef }: { playerRef: React.MutableRefObject<Player | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const playing = useVideo((s) => s.playing);
  const time = useVideo((s) => s.time);
  const fps = useVideo((s) => s.project.fps);
  const duration = useVideo((s) => projectDuration(s.project));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const player = new Player(canvas);
    playerRef.current = player;
    S().set({ thumbProvider: () => player.poster() });
    player.overlay = (ctx, scale) => {
      const s = S();
      const c = s.project.clips.find((x) => x.id === s.selectedId);
      if (!c || c.type === "audio" || s.playing || s.time < c.start || s.time >= clipEnd(c)) return;
      const b = clipBox(s.project, c, natural(c, s.assets));
      if (!b) return;
      ctx.save();
      ctx.translate(s.project.width / 2 + c.x, s.project.height / 2 + c.y);
      ctx.rotate((c.rotation * Math.PI) / 180);
      ctx.strokeStyle = "#8f82ff";
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.fillStyle = "#fff";
      const hs = 6 / scale;
      ctx.fillRect(b.w / 2 - hs, b.h / 2 - hs, hs * 2, hs * 2);
      ctx.strokeRect(b.w / 2 - hs, b.h / 2 - hs, hs * 2, hs * 2);
      ctx.restore();
    };
    const ro = new ResizeObserver(player.request);
    ro.observe(boxRef.current!);

    const toProject = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const p = S().project;
      return { x: ((e.clientX - r.left) / r.width) * p.width - p.width / 2, y: ((e.clientY - r.top) / r.height) * p.height - p.height / 2, k: p.width / r.width };
    };
    const inside = (c: Clip, x: number, y: number, pad = 0) => {
      const b = clipBox(S().project, c, natural(c, S().assets));
      if (!b) return null;
      const r = (-c.rotation * Math.PI) / 180;
      const dx = x - c.x, dy = y - c.y;
      const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
      return { hit: Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad, corner: Math.abs(lx - b.w / 2) < pad * 2 && Math.abs(ly - b.h / 2) < pad * 2 };
    };
    const down = (e: PointerEvent) => {
      const s = S();
      const p0 = toProject(e);
      const locked = new Set(s.project.tracks.filter((t) => t.locked).map((t) => t.id));
      const sel = s.project.clips.find((c) => c.id === s.selectedId);
      const selHit = sel && sel.type !== "audio" && s.time >= sel.start && s.time < clipEnd(sel) ? inside(sel, p0.x, p0.y, 8 * p0.k) : null;
      let target = selHit?.corner || selHit?.hit ? sel! : null;
      if (!target) {
        const vis = visibleClips(s.project, s.time).filter((v) => !v.tail).reverse();
        target = vis.find((v) => inside(v.clip, p0.x, p0.y)?.hit)?.clip ?? null;
        s.set({ selectedId: target?.id ?? null });
      }
      if (!target || locked.has(target.trackId)) return;
      canvas.setPointerCapture(e.pointerId);
      const start = target;
      const scaling = !!selHit?.corner;
      const d0 = Math.hypot(p0.x - start.x, p0.y - start.y) || 1;
      let moved = false;
      const mv = (ev: PointerEvent) => {
        const p = toProject(ev);
        if (!moved) {
          if (Math.hypot(p.x - p0.x, p.y - p0.y) < 3 * p.k) return;
          moved = true;
          S().snapshot();
        }
        if (scaling) S().updateClip(start.id, { scale: clamp((start.scale * Math.hypot(p.x - start.x, p.y - start.y)) / d0, 0.05, 8) }, false);
        else {
          let x = start.x + p.x - p0.x, y = start.y + p.y - p0.y;
          const tol = 8 * p.k;
          if (!ev.altKey) {
            if (Math.abs(x) < tol) x = 0;
            if (Math.abs(y) < tol) y = 0;
          }
          S().updateClip(start.id, { x, y }, false);
        }
      };
      const up = () => {
        canvas.removeEventListener("pointermove", mv);
        canvas.removeEventListener("pointerup", up);
      };
      canvas.addEventListener("pointermove", mv);
      canvas.addEventListener("pointerup", up);
    };
    canvas.addEventListener("pointerdown", down);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      ro.disconnect();
      player.destroy();
      playerRef.current = null;
      S().set({ thumbProvider: null, playing: false });
    };
  }, [playerRef]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <canvas ref={canvasRef} className="touch-none rounded-sm shadow-2xl ring-1 ring-line" />
      </div>
      <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-t border-line bg-panel">
        <span className="w-24 text-right font-mono text-xs tabular-nums">{formatTime(time, fps)}</span>
        <div className="mx-2 flex items-center gap-0.5">
          <IconButton label="Go to start (Home)" onClick={() => S().set({ time: 0, playing: false })}><ChevronFirst size={16} /></IconButton>
          <IconButton label="Previous frame (←)" onClick={() => seekFrames(-1)}><StepBack size={15} /></IconButton>
          <button
            aria-label={playing ? "Pause (Space)" : "Play (Space)"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            disabled={duration <= 0}
            onClick={togglePlay}
            className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg hover:brightness-90 disabled:opacity-40"
          >
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
          <IconButton label="Next frame (→)" onClick={() => seekFrames(1)}><StepForward size={15} /></IconButton>
          <IconButton label="Go to end (End)" onClick={() => S().set({ time: duration, playing: false })}><ChevronLast size={16} /></IconButton>
        </div>
        <span className="w-24 font-mono text-xs tabular-nums text-muted">{formatTime(duration, fps)}</span>
      </div>
    </div>
  );
}

/* ---------- media + text library ---------- */
interface TextPreset { name: string; desc: string; duration: number; anim?: Clip["anim"]; xFrac?: number; yFrac?: number; style: Partial<TextStyle> }
const TEXT_PRESETS: TextPreset[] = [
  { name: "Title", desc: "Large centred heading", duration: 4, anim: "fade", style: { text: "Your title", fontSize: 140, fontWeight: 800 } },
  { name: "Subtitle", desc: "Caption near the bottom", duration: 3, yFrac: 0.38, style: { text: "Subtitle text goes here", fontSize: 54, fontWeight: 600, bg: "#000000", bgPadding: 16, bgRadius: 8 } },
  { name: "Lower third", desc: "Name strap, bottom left", duration: 4, anim: "slide-up", xFrac: -0.27, yFrac: 0.34, style: { text: "Name Surname\nJob title", fontSize: 48, fontWeight: 700, align: "left", bg: "#7c6cff", bgPadding: 22, bgRadius: 6, lineHeight: 1.25 } },
  { name: "Typewriter", desc: "Text typed letter by letter", duration: 4, anim: "typewriter", style: { text: "Typed out line by line", fontSize: 72, fontFamily: "Courier New", fontWeight: 700 } },
  { name: "Outline pop", desc: "Bold outlined callout", duration: 2.5, anim: "pop", style: { text: "WOW", fontSize: 220, fontWeight: 900, fontFamily: "Impact", strokeWidth: 12, stroke: "#000000", color: "#ffe14d" } },
];

function Library({ onFiles }: { onFiles: (files: File[]) => void }) {
  const assets = useVideo((s) => s.assets);
  const clips = useVideo((s) => s.project.clips);
  const [tab, setTab] = useState<"media" | "text">("media");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const srtRef = useRef<HTMLInputElement>(null);
  const [canTranscribe, setCanTranscribe] = useState(false);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const list = Object.values(assets);
  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json()).then((d) => setCanTranscribe(!!d.capabilities?.transcribe?.available)).catch(() => {});
  }, []);

  const importSubs = async (f: File) => {
    if (f.size > 5 * 1048576) return toast("Subtitle files are limited to 5 MB.", "error");
    const n = addSubtitleTrack(parseSubtitles(await f.text()));
    toast(n ? `Added ${n} subtitles on a new track.` : "No subtitle cues were found in that file.", n ? "success" : "error");
  };
  const transcribe = async () => {
    try {
      const n = addSubtitleTrack(await transcribeTimeline(setTranscribing));
      toast(n ? `Added ${n} subtitles on a new track.` : "No speech was detected.", n ? "success" : "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Transcription failed.", "error");
    } finally {
      setTranscribing(null);
    }
  };

  const remove = async (a: MediaAsset) => {
    const used = clips.filter((c) => c.assetId === a.id).length;
    if (used && !confirm(`"${a.name}" is used by ${used} clip${used > 1 ? "s" : ""}. Remove it and those clips?`)) return;
    S().setProject((p) => ({ ...p, clips: p.clips.filter((c) => c.assetId !== a.id) }));
    const next = { ...S().assets };
    delete next[a.id];
    S().set({ assets: next });
    URL.revokeObjectURL(a.url);
    await db.deleteAsset(a.id).catch(() => {});
  };

  const addText = (p: TextPreset) => {
    const { project } = S();
    const k = Math.min(project.width, project.height) / 1080;
    const style = { ...p.style, fontSize: Math.round((p.style.fontSize ?? 96) * k), bgPadding: Math.round((p.style.bgPadding ?? 24) * k), strokeWidth: Math.round((p.style.strokeWidth ?? 0) * k) };
    S().addTextClip({ duration: p.duration, anim: p.anim ?? "none", x: (p.xFrac ?? 0) * project.width, y: (p.yFrac ?? 0) * project.height, style });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "media", label: "Media" }, { value: "text", label: "Text" }]} />
      {tab === "media" ? (
        <div
          className={cn("flex min-h-0 flex-1 flex-col", over && "bg-accent-soft")}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files)); }}
        >
          <div className="p-2.5">
            <Button className="w-full" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import media</Button>
            <input ref={fileRef} type="file" hidden multiple accept="video/*,audio/*,image/*,.mov,.mkv" onChange={(e) => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = ""; }} />
          </div>
          {list.length === 0 && <p className="px-4 py-6 text-center text-xs leading-relaxed text-muted">Drop video, audio or images here. MP4, WebM and MOV (where your browser can decode it), MP3, WAV, AAC, PNG, JPEG.</p>}
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2.5">
            {list.map((a) => (
              <li
                key={a.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/cs-asset", a.id); e.dataTransfer.effectAllowed = "copy"; }}
                className="group flex cursor-grab items-center gap-2 rounded-md border border-line bg-panel-2 p-1.5"
                title="Drag onto the timeline"
              >
                <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-panel-3 bg-cover bg-center text-muted" style={a.thumb ? { backgroundImage: `url(${a.thumb})` } : undefined}>
                  {!a.thumb && (a.kind === "audio" ? <Music size={16} /> : <Clapperboard size={16} />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{a.name}</span>
                  <span className="block font-mono text-[10px] text-muted">
                    {a.kind === "image" ? `${a.width}×${a.height}` : formatTime(a.duration).slice(0, 5)}{a.kind === "video" && ` · ${a.width}×${a.height}`} · {formatBytes(a.size)}
                  </span>
                </span>
                <IconButton className="h-6 w-6" label={`Add ${a.name} at playhead`} onClick={() => !S().addAssetClip(a) && toast("Add an unlocked track of the right type first.", "error")}><Plus size={13} /></IconButton>
                <IconButton className="h-6 w-6 opacity-0 group-hover:opacity-100" label={`Remove ${a.name}`} onClick={() => remove(a)}><Trash2 size={12} /></IconButton>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto p-2.5">
          {TEXT_PRESETS.map((p) => (
            <li key={p.name}>
              <button className="flex w-full items-center gap-2.5 rounded-md border border-line bg-panel-2 p-2 text-left hover:border-accent/60" onClick={() => addText(p)}>
                <Type size={15} className="shrink-0 text-accent" />
                <span><span className="block text-xs font-medium">{p.name}</span><span className="block text-[11px] text-muted">{p.desc}</span></span>
              </button>
            </li>
          ))}
          <li className="pt-3">
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Subtitles</p>
            <div className="flex flex-col gap-1.5">
              <Button size="sm" onClick={() => srtRef.current?.click()}><Captions size={13} /> Import .srt / .vtt</Button>
              <Button size="sm" disabled={!canTranscribe || !!transcribing} loading={!!transcribing} onClick={transcribe} title={canTranscribe ? "Transcribe the timeline audio" : "Needs a speech-to-text provider key on the server"}>
                <Sparkles size={13} /> {transcribing ?? "Auto subtitles"}
              </Button>
              {!canTranscribe && <p className="px-1 text-[11px] leading-relaxed text-muted">Auto subtitles need a speech provider key on the server (see Settings).</p>}
            </div>
            <input ref={srtRef} type="file" accept=".srt,.vtt" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importSubs(f); }} />
          </li>
          <li className="px-1 pt-2 text-[11px] leading-relaxed text-muted">Text is added at the playhead. Drag it in the preview to position it; fonts from your Brand Kit appear in the font list.</li>
        </ul>
      )}
    </aside>
  );
}

/* ---------- editor ---------- */
export function VideoEditor() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [timelineH, setTimelineH] = useState(280);
  const playerRef = useRef<Player | null>(null);
  const s = useVideo();

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (!id) {
          const p = await createBlankProject("video", "Untitled video", () => ({ project: { ...emptyVideoProject(), sizeFromMedia: true } }));
          if (!dead) router.replace(`/video?id=${p.id}`);
          return;
        }
        const p = await db.getProject(id);
        if (!p || p.kind !== "video") throw new Error("This video project could not be found. It may have been deleted.");
        await loadBrandFonts();
        await S().load(p);
        if (!dead) setReady(true);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "Could not open the project.");
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, router]);

  useEffect(() => {
    const save = debounce(() => S().save().catch(() => toast("Autosave failed. Your browser storage may be full.", "error")), 1500);
    const unsub = useVideo.subscribe((st, prev) => {
      if (st.dirty && (st.project !== prev.project || st.name !== prev.name)) save();
    });
    return () => {
      unsub();
      save.cancel();
      if (S().dirty) S().save().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      const st = S();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? st.redo() : st.undo(); }
      if (mod && k === "y") { e.preventDefault(); return st.redo(); }
      if (mod && k === "s") { e.preventDefault(); return void st.save().then(() => toast("Saved", "success")).catch(() => toast("Save failed.", "error")); }
      if (mod && k === "d") { e.preventDefault(); return st.selectedId ? st.duplicateClip(st.selectedId) : undefined; }
      if (mod) return;
      if (k === " ") { e.preventDefault(); return togglePlay(); }
      if (k === "s") return void (!st.split() && toast("Move the playhead inside a clip to split it."));
      if ((k === "delete" || k === "backspace") && st.selectedId) return st.removeClip(st.selectedId);
      if (k === "arrowleft") { e.preventDefault(); return seekFrames(e.shiftKey ? -10 : -1); }
      if (k === "arrowright") { e.preventDefault(); return seekFrames(e.shiftKey ? 10 : 1); }
      if (k === "home") return st.set({ time: 0, playing: false });
      if (k === "end") return st.set({ time: projectDuration(st.project), playing: false });
      if (k === "=" || k === "+") return st.set({ pxPerSec: clamp(st.pxPerSec * 1.4, 4, 800) });
      if (k === "-") return st.set({ pxPerSec: clamp(st.pxPerSec / 1.4, 4, 800) });
      if (k === "escape") return st.set({ selectedId: null });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const onFiles = async (files: File[]) => {
    const pid = S().projectId;
    if (!pid) return;
    for (const f of files) {
      setImporting((n) => n + 1);
      try {
        const asset = await importMedia(pid, f, (aid, p) => {
          const cur = S().assets[aid];
          if (cur) S().set({ assets: { ...S().assets, [aid]: { ...cur, ...p } } });
        });
        S().set({ assets: { ...S().assets, [asset.id]: asset } });
        // In a blank project nobody chose a size for, the first video sets the frame size.
        if (asset.kind === "video" && S().project.sizeFromMedia && S().project.clips.length === 0 && asset.width && asset.height) {
          S().setProject((p) => ({ ...p, width: Math.round(asset.width / 2) * 2, height: Math.round(asset.height / 2) * 2, sizeFromMedia: false }), false);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : `Could not import "${f.name}".`, "error");
      } finally {
        setImporting((n) => n - 1);
      }
    }
  };

  const freeze = async (clip: Clip) => {
    const st = S();
    const frame = playerRef.current?.grab(clip.id);
    if (!frame || !st.projectId) return toast("The frame is still loading. Try again in a moment.");
    try {
      const blob = await canvasToBlob(frame, "image/png");
      const asset = await importMedia(st.projectId, new File([blob], `Freeze ${formatTime(st.time, st.project.fps)}.png`, { type: "image/png" }));
      const t = st.time, hold = 2;
      st.set({ assets: { ...S().assets, [asset.id]: asset } });
      st.setProject((p): VideoProject => {
        const head = t - clip.start;
        const still = makeClip("image", clip.trackId, t, hold, asset.name, { assetId: asset.id, x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation, opacity: clip.opacity, crop: clip.crop, flipX: clip.flipX, adjustments: clip.adjustments, filter: clip.filter, lutId: clip.lutId, lutMix: clip.lutMix });
        return {
          ...p,
          clips: [
            ...p.clips.flatMap((c) => {
              if (c.id === clip.id) return [{ ...c, duration: head, transOut: { ...c.transOut, type: "none" as const } }, { ...structuredClone(c), id: uid(), start: t + hold, duration: c.duration - head, offset: c.offset + head * c.speed, transIn: { ...c.transIn, type: "none" as const } }];
              // Everything later on the same track moves right to make room.
              return c.trackId === clip.trackId && c.start >= t ? [{ ...c, start: c.start + hold }] : [c];
            }),
            still,
          ],
        };
      });
      st.set({ selectedId: null });
    } catch {
      toast("Could not create the freeze frame.", "error");
    }
  };

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = timelineH;
    const mv = (ev: PointerEvent) => setTimelineH(clamp(h0 + y0 - ev.clientY, 140, window.innerHeight - 260));
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>{error}</p>
        <Button onClick={() => router.push("/projects")}>Back to projects</Button>
      </div>
    );
  if (!ready) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted"><Spinner /> Opening project</div>;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <EditorTopBar
        name={s.name}
        onRename={(name) => s.set({ name, dirty: true })}
        canUndo={s.past.length > 0}
        canRedo={s.future.length > 0}
        onUndo={s.undo}
        onRedo={s.redo}
        dirty={s.dirty}
        saving={s.saving}
        savedAt={s.savedAt}
        onSave={() => s.save().then(() => toast("Saved", "success")).catch(() => toast("Save failed. Your browser storage may be full.", "error"))}
        onExport={() => setExporting(true)}
      >
        {importing > 0 && <span className="flex items-center gap-1.5 text-xs text-muted"><Spinner size={13} /> Importing {importing} file{importing > 1 ? "s" : ""}</span>}
        <span className="font-mono text-[11px] text-muted">{s.project.width} × {s.project.height} · {s.project.fps} fps</span>
      </EditorTopBar>
      <div className="flex min-h-0 flex-1">
        <Library onFiles={onFiles} />
        <Preview playerRef={playerRef} />
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel">
          <Inspector onFreeze={freeze} />
        </aside>
      </div>
      <div className="h-1 shrink-0 cursor-row-resize bg-line/60 hover:bg-accent" onPointerDown={startResize} role="separator" aria-label="Resize timeline" />
      <div className="shrink-0" style={{ height: timelineH }}>
        <Timeline />
      </div>
      {exporting && <VideoExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
