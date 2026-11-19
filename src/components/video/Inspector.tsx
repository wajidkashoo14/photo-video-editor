"use client";

import { FlipHorizontal2, Snowflake, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TextStyleEditor } from "@/components/TextStyleEditor";
import { Button, Field, Modal, NumberInput, Progress, Section, Select, Slider, toast } from "@/components/ui";
import { ADJ_GROUPS, DEFAULT_ADJ, GRADE_GROUP, LOOKS, type Adjustments } from "@/lib/adjustments";
import { db } from "@/lib/db";
import { usePageActivity } from "@/lib/hooks";
import { clamp, downloadBlob, formatBytes, guardUnload, safeName, uid } from "@/lib/utils";
import { canEncode, exportVideo, type VideoExportResult } from "@/lib/video/export";
import { TEXT_ANIMS, TRANSITIONS, TRANSITION_LABELS, clipEnd, projectDuration, type Clip, type TextAnim, type Transition, type TransitionType } from "@/lib/video/types";
import { useVideo } from "@/stores/videoStore";

const SIZES = [
  { label: "1920 × 1080 (16:9)", w: 1920, h: 1080 },
  { label: "1280 × 720 (16:9)", w: 1280, h: 720 },
  { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { label: "1080 × 1920 (9:16)", w: 1080, h: 1920 },
  { label: "1080 × 1080 (1:1)", w: 1080, h: 1080 },
  { label: "1080 × 1350 (4:5)", w: 1080, h: 1350 },
];
const FPS = [24, 25, 30, 50, 60];

function ProjectSettings() {
  const project = useVideo((s) => s.project);
  const { setProject } = useVideo.getState();
  const key = `${project.width}x${project.height}`;
  return (
    <div>
      <Section title="Project">
        <Field label="Frame size">
          <Select
            label="Frame size"
            className="w-44"
            value={SIZES.some((s) => `${s.w}x${s.h}` === key) ? key : "custom"}
            onChange={(v) => {
              const s = SIZES.find((x) => `${x.w}x${x.h}` === v);
              if (s) setProject((p) => ({ ...p, width: s.w, height: s.h, sizeFromMedia: false }));
            }}
            options={[...SIZES.map((s) => ({ value: `${s.w}x${s.h}`, label: s.label })), ...(SIZES.some((s) => `${s.w}x${s.h}` === key) ? [] : [{ value: "custom", label: `${project.width} × ${project.height}` }])]}
          />
        </Field>
        <Field label="Width"><NumberInput value={project.width} min={16} max={7680} step={2} onChange={(v) => setProject((p) => ({ ...p, width: Math.round(v / 2) * 2, sizeFromMedia: false }))} /></Field>
        <Field label="Height"><NumberInput value={project.height} min={16} max={4320} step={2} onChange={(v) => setProject((p) => ({ ...p, height: Math.round(v / 2) * 2, sizeFromMedia: false }))} /></Field>
        <Field label="Frame rate">
          <Select label="Frame rate" className="w-24" value={String(project.fps)} onChange={(v) => setProject((p) => ({ ...p, fps: Number(v) }))} options={FPS.map((f) => ({ value: String(f), label: `${f} fps` }))} />
        </Field>
      </Section>
      <p className="px-4 py-6 text-center text-xs leading-relaxed text-muted">Select a clip on the timeline to edit its transform, speed, colour, audio and transitions.</p>
    </div>
  );
}

function TransitionRow({ label, value, max, onChange, onStart, dissolveHint }: { label: string; value: Transition; max: number; onChange: (t: Transition, history: boolean) => void; onStart: () => void; dissolveHint?: boolean }) {
  return (
    <>
      <Field label={label}>
        <Select<TransitionType> label={label} className="w-32" value={value.type} onChange={(v) => onChange({ ...value, type: v }, true)} options={TRANSITIONS.filter((t) => dissolveHint || t !== "dissolve").map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))} />
      </Field>
      {value.type !== "none" && <Slider label="Duration" min={0.1} max={Math.max(0.2, Math.min(5, max))} step={0.05} def={0.5} value={Math.min(value.duration, max)} format={(v) => `${v.toFixed(2)}s`} onStart={onStart} onChange={(v) => onChange({ ...value, duration: v }, false)} />}
    </>
  );
}

export function Inspector({ onFreeze }: { onFreeze: (clip: Clip) => void }) {
  const clip = useVideo((s) => s.project.clips.find((c) => c.id === s.selectedId) ?? null);
  const asset = useVideo((s) => (clip?.assetId ? s.assets[clip.assetId] : undefined));
  const lutNames = useVideo((s) => s.lutNames);
  const time = useVideo((s) => s.time);
  const lutFile = useRef<HTMLInputElement>(null);
  const { updateClip, snapshot, addLut, setProject } = useVideo.getState();
  if (!clip) return <ProjectSettings />;
  const set = (patch: Partial<Clip>, history = true) => updateClip(clip.id, patch, history);
  const a = clip.adjustments;
  const setAdj = (patch: Partial<Adjustments>, history = false) => set({ adjustments: { ...a, ...patch } }, history);
  const visual = clip.type !== "audio";
  const media = clip.type === "video" || clip.type === "image";
  const timed = clip.type === "video" || clip.type === "audio";
  const hasSound = timed && asset?.hasAudio;

  const setSpeed = (speed: number) => {
    // Keep the same source range: a faster clip gets shorter. Never run into the next clip.
    setProject((p) => {
      const next = Math.min(Infinity, ...p.clips.filter((c) => c.trackId === clip.trackId && c.start >= clipEnd(clip) - 1e-6).map((c) => c.start));
      const duration = Math.min((clip.duration * clip.speed) / speed, next - clip.start);
      return { ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, speed, duration } : c)) };
    });
  };

  return (
    <div>
      <div className="border-b border-line px-3 py-2">
        <p className="truncate text-xs font-medium">{clip.name}</p>
        <p className="font-mono text-[11px] text-muted">{clip.start.toFixed(2)}s → {clipEnd(clip).toFixed(2)}s · {clip.duration.toFixed(2)}s</p>
      </div>

      {clip.type === "text" && clip.style && (
        <Section title="Text">
          <TextStyleEditor style={clip.style} onStart={snapshot} onChange={(patch, history) => set({ style: { ...clip.style!, ...patch }, ...(patch.text !== undefined ? { name: patch.text.split("\n")[0].slice(0, 24) || "Text" } : {}) }, history)} />
          <Field label="Animation">
            <Select<TextAnim> label="Animation" className="w-32" value={clip.anim} onChange={(v) => set({ anim: v })} options={TEXT_ANIMS.map((t) => ({ value: t, label: t === "none" ? "None" : t === "slide-up" ? "Slide up" : t[0].toUpperCase() + t.slice(1) }))} />
          </Field>
          <Field label="Duration (s)"><NumberInput value={+clip.duration.toFixed(2)} min={0.1} step={0.1} onChange={(v) => set({ duration: v })} /></Field>
        </Section>
      )}

      {visual && (
        <Section title="Transform">
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="X"><NumberInput className="w-16" value={Math.round(clip.x)} onChange={(v) => set({ x: v })} /></Field>
            <Field label="Y"><NumberInput className="w-16" value={Math.round(clip.y)} onChange={(v) => set({ y: v })} /></Field>
          </div>
          <Slider label="Scale" min={5} max={400} def={100} value={Math.round(clip.scale * 100)} format={(v) => `${v}%`} onStart={snapshot} onChange={(v) => set({ scale: v / 100 }, false)} />
          <Slider label="Rotation" min={-180} max={180} def={0} value={Math.round(clip.rotation)} format={(v) => `${v}°`} onStart={snapshot} onChange={(v) => set({ rotation: v }, false)} />
          <Slider label="Opacity" min={0} max={100} def={100} value={Math.round(clip.opacity * 100)} onStart={snapshot} onChange={(v) => set({ opacity: v / 100 }, false)} />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {media && <Button size="sm" active={clip.flipX} onClick={() => set({ flipX: !clip.flipX })}><FlipHorizontal2 size={13} /> Flip</Button>}
            <Button size="sm" variant="ghost" onClick={() => set({ x: 0, y: 0, scale: 1, rotation: 0 })}>Reset</Button>
            {clip.type === "video" && (
              <Button size="sm" disabled={time <= clip.start || time >= clipEnd(clip)} title="Insert a 2 second still of the current frame" onClick={() => onFreeze(clip)}>
                <Snowflake size={13} /> Freeze frame
              </Button>
            )}
          </div>
        </Section>
      )}

      {media && (
        <Section title="Crop" defaultOpen={false}>
          {(["l", "t", "r", "b"] as const).map((k) => (
            <Slider key={k} label={{ l: "Left", t: "Top", r: "Right", b: "Bottom" }[k]} min={0} max={45} def={0} value={Math.round(clip.crop[k] * 100)} format={(v) => `${v}%`} onStart={snapshot} onChange={(v) => set({ crop: { ...clip.crop, [k]: v / 100 } }, false)} />
          ))}
        </Section>
      )}

      {timed && (
        <Section title="Speed">
          <Slider label="Speed" min={0.25} max={4} step={0.05} def={1} value={clip.speed} format={(v) => `${v.toFixed(2)}×`} onStart={snapshot} onChange={(v) => setSpeed(v)} />
          <div className="flex gap-1">
            {[0.5, 1, 1.5, 2].map((v) => (
              <Button key={v} size="sm" active={clip.speed === v} onClick={() => { snapshot(); setSpeed(v); }}>{v}×</Button>
            ))}
          </div>
        </Section>
      )}

      {hasSound && (
        <Section title="Audio">
          <Slider label="Volume" min={0} max={100} def={100} value={Math.round(clip.volume * 100)} format={(v) => `${v}%`} onStart={snapshot} onChange={(v) => set({ volume: v / 100 }, false)} />
          <Slider label="Fade in" min={0} max={Math.min(10, clip.duration)} step={0.1} def={0} value={Math.min(clip.fadeIn, clip.duration)} format={(v) => `${v.toFixed(1)}s`} onStart={snapshot} onChange={(v) => set({ fadeIn: v }, false)} />
          <Slider label="Fade out" min={0} max={Math.min(10, clip.duration)} step={0.1} def={0} value={Math.min(clip.fadeOut, clip.duration)} format={(v) => `${v.toFixed(1)}s`} onStart={snapshot} onChange={(v) => set({ fadeOut: v }, false)} />
        </Section>
      )}

      {visual && (
        <Section title="Transitions" defaultOpen={clip.transIn.type !== "none" || clip.transOut.type !== "none"}>
          <TransitionRow label="In" dissolveHint={media} value={clip.transIn} max={clip.duration} onStart={snapshot} onChange={(t, h) => set({ transIn: t }, h)} />
          <TransitionRow label="Out" value={clip.transOut} max={clip.duration} onStart={snapshot} onChange={(t, h) => set({ transOut: t }, h)} />
          {clip.transIn.type === "dissolve" && <p className="mt-1 text-[11px] leading-relaxed text-muted">Cross dissolve blends from the clip that ends where this one starts on the same track.</p>}
        </Section>
      )}

      {media && (
        <>
          <Section title="Look" defaultOpen={false}>
            <Field label="Preset">
              <Select label="Look preset" className="w-40" value={clip.filter.id ?? ""} onChange={(v) => set({ filter: { ...clip.filter, id: v || null } })} options={[{ value: "", label: "None" }, ...LOOKS.map((l) => ({ value: l.id, label: `${l.category} · ${l.name}` }))]} />
            </Field>
            {clip.filter.id && <Slider label="Intensity" min={0} max={100} def={100} value={clip.filter.intensity} onStart={snapshot} onChange={(v) => set({ filter: { ...clip.filter, intensity: v } }, false)} />}
            <Field label="LUT (.cube)">
              <Select label="LUT" className="w-40" value={clip.lutId ?? ""} onChange={(v) => set({ lutId: v || null })} options={[{ value: "", label: "None" }, ...Object.entries(lutNames).map(([id, name]) => ({ value: id, label: name }))]} />
            </Field>
            {clip.lutId && <Slider label="LUT strength" min={0} max={100} def={100} value={Math.round(clip.lutMix * 100)} onStart={snapshot} onChange={(v) => set({ lutMix: v / 100 }, false)} />}
            <Button size="sm" className="mt-1 w-full" onClick={() => lutFile.current?.click()}><Upload size={13} /> Import .cube LUT</Button>
            <input
              ref={lutFile}
              type="file"
              accept=".cube"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 20 * 1048576) return toast("That LUT file is too large (20 MB limit).", "error");
                try {
                  const id = await addLut(f.name.replace(/\.cube$/i, ""), await f.text());
                  set({ lutId: id });
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Could not read the LUT.", "error");
                }
              }}
            />
          </Section>
          <Section title="Colour" defaultOpen={false} action={<Button size="sm" variant="ghost" onClick={() => setAdj({ ...DEFAULT_ADJ }, true)}>Reset</Button>}>
            {[...ADJ_GROUPS[0].items.filter((i) => i.key !== "gamma"), ...ADJ_GROUPS[1].items, ...GRADE_GROUP, ...ADJ_GROUPS[2].items.filter((i) => i.key === "sharpness"), ...ADJ_GROUPS[3].items].map((it) => (
              <Slider key={it.key} label={it.label} min={it.min} max={it.max} value={a[it.key]} onStart={snapshot} onChange={(v) => setAdj({ [it.key]: v })} />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

/* ================= Export ================= */
const QUALITY = [
  { id: "low", label: "Low (small file)", bpp: 0.045 },
  { id: "medium", label: "Medium", bpp: 0.075 },
  { id: "high", label: "High", bpp: 0.12 },
  { id: "max", label: "Very high", bpp: 0.2 },
];
const SHORT_EDGES = [720, 1080, 1440, 2160];
const even = (n: number) => Math.round(n / 2) * 2;

export function VideoExportDialog({ onClose }: { onClose: () => void }) {
  const project = useVideo((s) => s.project);
  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [edge, setEdge] = useState(Math.min(1080, SHORT_EDGES.findLast((e) => e <= Math.min(project.width, project.height)) ?? 720));
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState("high");
  const [mbps, setMbps] = useState<number | null>(null);
  const [supported, setSupported] = useState<Record<number, boolean>>({});
  const [state, setState] = useState<{ stage: string; f: number } | null>(null);
  const [result, setResult] = useState<(VideoExportResult & { filename: string; seconds: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const k = edge / Math.min(project.width, project.height);
  const width = even(project.width * k), height = even(project.height * k);
  const auto = (width * height * fps * QUALITY.find((q) => q.id === quality)!.bpp) / 1e6;
  const bitrate = Math.round((mbps ?? auto) * 1e6);
  const duration = projectDuration(project);

  // Only offer resolutions this browser's encoder really accepts.
  useEffect(() => {
    let dead = false;
    (async () => {
      const out: Record<number, boolean> = {};
      for (const e of SHORT_EDGES) {
        const s = e / Math.min(project.width, project.height);
        out[e] = await canEncode(format, even(project.width * s), even(project.height * s)).catch(() => false);
      }
      if (!dead) setSupported(out);
    })();
    return () => {
      dead = true;
    };
  }, [format, project.width, project.height]);
  // The export carries on while another page is open, and reports by toast if it ends there.
  // It stops only if the editor is dropped altogether (see usePageActivity). Closing or reloading
  // the tab while it runs asks first (guardUnload).
  const { attach, hidden, gone } = usePageActivity();

  const run = async () => {
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const t0 = performance.now();
    const s = useVideo.getState();
    s.set({ playing: false });
    const release = guardUnload();
    try {
      const onProgress =(stage: string, f: number) => (gone() ? ctrl.abort() : setState({ stage, f }));
      const r = await exportVideo(s.project, s.assets, s.luts, { format, width, height, fps, bitrate, signal: ctrl.signal, onProgress });
      const filename = `${safeName(s.name)}.${format}`;
      downloadBlob(r.blob, filename);
      setResult({ ...r, filename, seconds: (performance.now() - t0) / 1000 });
      db.putExport({ id: uid(), projectId: s.projectId ?? "", projectName: s.name, kind: "video", filename, mime: r.mime, width, height, size: r.blob.size, createdAt: Date.now(), blob: r.blob.size < 512 * 1048576 ? r.blob : undefined }).catch(() => {});
      if (hidden()) toast(`Exported ${filename} (${formatBytes(r.blob.size)}). It is in your downloads and in Export History.`, "success");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        const message = e instanceof Error ? e.message : "Export failed.";
        setError(message);
        if (hidden()) toast(`Video export failed: ${message}`, "error");
      } else if (gone()) {
        toast("Video export stopped: the editor was unloaded after you opened other pages. Open the project and export again.", "error");
      }
    } finally {
      release();
      setState(null);
      abort.current = null;
    }
  };

  const busy = !!state;
  return (
    <Modal title="Export video" onClose={() => { abort.current?.abort(); onClose(); }} width={420}>
      <fieldset ref={attach} disabled={busy} className="disabled:opacity-60">
        <Field label="Format">
          <Select label="Format" className="w-44" value={format} onChange={setFormat} options={[{ value: "mp4", label: "MP4 (H.264 / AAC)" }, { value: "webm", label: "WebM (VP9 / Opus)" }]} />
        </Field>
        <Field label="Resolution">
          <Select
            label="Resolution"
            className="w-44"
            value={String(edge)}
            onChange={(v) => setEdge(Number(v))}
            options={SHORT_EDGES.filter((e) => supported[e] !== false).map((e) => ({ value: String(e), label: `${e === 2160 ? "4K" : `${e}p`} · ${even((project.width * e) / Math.min(project.width, project.height))} × ${even((project.height * e) / Math.min(project.width, project.height))}` }))}
          />
        </Field>
        <Field label="Frame rate">
          <Select label="Frame rate" className="w-44" value={String(fps)} onChange={(v) => setFps(Number(v))} options={FPS.map((f) => ({ value: String(f), label: `${f} fps` }))} />
        </Field>
        <Field label="Quality">
          <Select label="Quality" className="w-44" value={mbps === null ? quality : "custom"} onChange={(v) => { if (v === "custom") setMbps(+auto.toFixed(1)); else { setMbps(null); setQuality(v); } }} options={[...QUALITY.map((q) => ({ value: q.id, label: q.label })), { value: "custom", label: "Custom bitrate" }]} />
        </Field>
        {mbps !== null && <Field label="Bitrate (Mbps)"><NumberInput value={mbps} min={0.2} max={200} step={0.5} onChange={(v) => setMbps(clamp(v, 0.2, 200))} /></Field>}
      </fieldset>
      <p className="mt-2 font-mono text-[11px] text-muted">
        {width} × {height} · {fps} fps · {(bitrate / 1e6).toFixed(1)} Mbps · about {formatBytes(((bitrate + 192_000) * duration) / 8)}
      </p>
      {Object.values(supported).some((v) => v === false) && <p className="mt-1 text-[11px] text-muted">Resolutions this browser&apos;s encoder cannot produce are hidden.</p>}
      {state && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs"><span>{state.stage}</span><span className="font-mono">{Math.round(state.f * 100)}%</span></div>
          <Progress value={state.f} />
        </div>
      )}
      {error && <p className="mt-3 rounded-md bg-danger/10 p-2 text-xs text-danger">{error}</p>}
      {result && (
        <div className="mt-3 rounded-md bg-panel-2 p-2 text-[11px] text-success">
          Exported {result.filename} · {formatBytes(result.blob.size)} · {result.frames} frames in {result.seconds.toFixed(1)}s · {result.videoCodec}{result.audioCodec ? ` + ${result.audioCodec}` : ", no audio"}
          <Button size="sm" className="ml-2" onClick={() => downloadBlob(result.blob, result.filename)}>Download again</Button>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {busy ? <Button variant="danger" onClick={() => abort.current?.abort()}>Cancel export</Button> : <Button onClick={onClose}>Close</Button>}
        <Button variant="primary" loading={busy} disabled={duration <= 0} onClick={run}>{duration <= 0 ? "Timeline is empty" : "Export"}</Button>
      </div>
    </Modal>
  );
}
