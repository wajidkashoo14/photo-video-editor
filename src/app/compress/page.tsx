"use client";

import { AlertTriangle, CheckCircle2, Download, Film, Info, RotateCcw, ShieldCheck, SplitSquareHorizontal, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Page } from "@/components/AppShell";
import { Button, Field, IconButton, NumberInput, Progress, Select, Spinner, Toggle, toast } from "@/components/ui";
import { FrameCompare } from "@/components/video/FrameCompare";
import { VIDEO_TYPES, classifyFile } from "@/config/app";
import { db } from "@/lib/db";
import { usePageActivity } from "@/lib/hooks";
import { cn, downloadBlob, formatBytes, guardUnload, safeName, uid } from "@/lib/utils";
import {
  CODECS, DEFAULT_COMPRESS, GOALS, codecName, compressVideo, encodableCodecs, measureQuality, planCompression, probeVideo, verdict,
  type CodecId, type CompressResult, type CompressSettings, type QualityReport, type VideoProbe,
} from "@/lib/video/compress";

type Status = "reading" | "queued" | "working" | "checking" | "done" | "kept" | "error" | "cancelled";

interface Done {
  result: CompressResult;
  filename: string;
  settings: CompressSettings;
  quality: QualityReport | null;
  qualityError?: string;
  saved: boolean;
}

interface Item {
  id: string;
  file: File;
  name: string;
  status: Status;
  probe?: VideoProbe;
  stage?: string;
  progress?: number;
  message?: string;
  done?: Done;
}

interface Job { id: string; file: File; name: string; probe: VideoProbe }

const EDGES = [2160, 1440, 1080, 720, 480];
const SIZE_CHIPS = [10, 25, 50, 100];
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const clock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:` : "") + `${Math.floor((s % 3600) / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const describe = (p: VideoProbe) =>
  [`${p.width}×${p.height}`, p.fps && `${Math.round(p.fps * 100) / 100} fps`, codecName(p.codec), p.videoBitrate && `${(p.videoBitrate / 1e6).toFixed(1)} Mbps`, clock(p.duration), formatBytes(p.size)].filter(Boolean).join(" · ");

/** What to try after a setting gave no real saving: a stronger codec this browser has, the next goal down, or a lower resolution. */
function noSavingTip({ goal, codec }: CompressSettings, available: CodecId[]) {
  if (goal === "size") return "a smaller target";
  const next = goal === "lossless" ? "the Balanced goal" : goal === "balanced" ? "the Smallest goal" : null;
  const stronger = codec === "avc" ? (["hevc", "av1"] as const).filter((c) => available.includes(c)).map(codecName).join(" or ") : "";
  if (stronger) return `${stronger}, or ${next ?? "a lower resolution"}`;
  return next ? `${next} or a lower resolution` : "a lower resolution or a size target";
}

export default function CompressPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<CompressSettings>(DEFAULT_COMPRESS);
  const [codecs, setCodecs] = useState<CodecId[] | null>(null);
  const [over, setOver] = useState(false);
  const [comparing, setComparing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef(settings);
  const codecsRef = useRef<CodecId[]>([]);
  const queue = useRef<Job[]>([]);
  const removed = useRef(new Set<string>());
  const working = useRef(false);
  const current = useRef<{ id: string; ctrl: AbortController } | null>(null);
  // The batch carries on while another page is open, and stops if this page is dropped.
  const { attach, gone } = usePageActivity();
  // Nothing on screen would show that the batch stopped, so say it where the user is.
  const dropped = (unfinished: number) => {
    queue.current = [];
    toast(`Compress Video stopped with ${unfinished} video${unfinished === 1 ? "" : "s"} unfinished: the page was unloaded after you opened other pages. Add ${unfinished === 1 ? "it" : "them"} again to continue.`, "error");
  };

  useEffect(() => {
    encodableCodecs().then((list) => {
      codecsRef.current = list;
      setCodecs(list);
      if (list.length && !list.includes(settingsRef.current.codec)) {
        settingsRef.current = { ...settingsRef.current, codec: list[0] };
        setSettings(settingsRef.current);
      }
    });
  }, []);

  const set = (p: Partial<CompressSettings>) => {
    const next = { ...settingsRef.current, ...p }; // the ref, so two changes before a re-render both stick
    settingsRef.current = next;
    setSettings(next);
  };
  const patch = (id: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const add = (files: File[]) => {
    const fresh: Item[] = [];
    for (const f of files) {
      try {
        if (classifyFile(f) !== "video") throw new Error(`"${f.name}" is not a video.`);
        fresh.push({ id: uid(), file: f, name: f.name.replace(/\.\w+$/, ""), status: "reading" });
      } catch (e) {
        toast(errText(e, "Unsupported file."), "error");
      }
    }
    if (!fresh.length) return;
    setItems((cur) => [...cur, ...fresh]);
    // Read the files one after another so they are compressed in the order they are listed.
    void (async () => {
      for (const it of fresh) {
        if (gone()) return;
        if (removed.current.has(it.id)) continue;
        try {
          const probe = await probeVideo(it.file);
          if (gone()) return;
          if (removed.current.has(it.id)) continue; // removed while it was being read
          patch(it.id, { probe, status: "queued" });
          queue.current.push({ id: it.id, file: it.file, name: it.name, probe });
          void pump();
        } catch (e) {
          patch(it.id, { status: "error", message: errText(e, "This file could not be read.") });
        }
      }
    })();
  };

  // One video at a time: encoders and decoders are shared hardware. While the batch runs, closing
  // or reloading the tab asks first (guardUnload).
  const pump = async () => {
    if (working.current) return;
    working.current = true;
    const release = guardUnload();
    for (let job = queue.current.shift(); job; job = queue.current.shift()) {
      if (gone()) {
        dropped(1 + queue.current.length);
        break;
      }
      const s = settingsRef.current;
      const ctrl = new AbortController();
      current.current = { id: job.id, ctrl };
      const id = job.id;
      const progress = (p: Partial<Item>) => (gone() ? ctrl.abort() : patch(id, p));
      try {
        patch(job.id, { status: "working", stage: "Preparing", progress: 0, message: undefined, done: undefined });
        const planned = await planCompression(job.probe, s);
        if (!planned.ok) {
          patch(job.id, { status: "kept", message: planned.reason });
          continue;
        }
        const result = await compressVideo(job.file, job.probe, planned.plan, (stage, f) => progress({ stage, progress: f }), ctrl.signal);
        if (result.blob.size >= job.file.size * 0.97) {
          const tip = noSavingTip(s, codecsRef.current);
          const message = result.blob.size >= job.file.size
            ? `No saving: this setting made ${formatBytes(result.blob.size)}, more than the original. The original is already compressed at least this much, so it was kept. Try ${tip}.`
            : `No real saving: this setting made ${formatBytes(result.blob.size)}, less than 3% smaller, so the original was kept. Try ${tip}.`;
          patch(job.id, { status: "kept", message });
          continue;
        }
        patch(job.id, { status: "checking", stage: "Checking quality against the original", progress: 0 });
        let quality: QualityReport | null = null;
        let qualityError: string | undefined;
        try {
          quality = await measureQuality(job.file, result.blob, ctrl.signal, (f) => progress({ progress: f }));
        } catch (e) {
          if (isAbort(e)) throw e;
          qualityError = errText(e, "The quality check failed.");
        }
        const ext = result.extension.replace(/^\./, "");
        patch(job.id, { status: "done", done: { result, filename: `${safeName(job.name)}-compressed.${ext}`, settings: s, quality, qualityError, saved: false } });
      } catch (e) {
        if (isAbort(e) && gone()) {
          dropped(1 + queue.current.length);
          break;
        }
        patch(job.id, isAbort(e) ? { status: "cancelled", message: "Cancelled." } : { status: "error", message: errText(e, "Compression failed.") });
      } finally {
        current.current = null;
      }
    }
    working.current = false;
    release();
  };

  const requeue = (it: Item) => {
    if (!it.probe) return;
    patch(it.id, { status: "queued", message: undefined, done: undefined, progress: 0 });
    queue.current.push({ id: it.id, file: it.file, name: it.name, probe: it.probe });
    void pump();
  };
  const cancel = (id: string) => {
    if (current.current?.id === id) current.current.ctrl.abort();
  };
  const remove = (id: string) => {
    removed.current.add(id);
    cancel(id);
    queue.current = queue.current.filter((j) => j.id !== id);
    setItems((l) => l.filter((x) => x.id !== id));
    if (comparing === id) setComparing(null);
  };

  const save = (it: Item) => {
    const d = it.done!;
    downloadBlob(d.result.blob, d.filename);
    if (d.saved) return;
    patch(it.id, { done: { ...d, saved: true } });
    const big = d.result.blob.size >= 512 * 1048576;
    db.putExport({ id: uid(), projectId: "", projectName: "Compress Video", kind: "video", filename: d.filename, mime: d.result.blob.type, width: d.result.width, height: d.result.height, size: d.result.blob.size, createdAt: Date.now(), blob: big ? undefined : d.result.blob }).catch(() => {});
  };
  const saveAll = async () => {
    setDownloading(true);
    for (const it of items.filter((i) => i.done)) {
      save(it);
      await new Promise((r) => setTimeout(r, 350)); // browsers drop downloads fired in the same tick
    }
    setDownloading(false);
  };

  const finished = items.filter((i) => i.done);
  const before = finished.reduce((n, i) => n + i.file.size, 0);
  const after = finished.reduce((n, i) => n + i.done!.result.blob.size, 0);
  const pending = items.filter((i) => ["reading", "queued", "working", "checking"].includes(i.status)).length;
  const comparedItem = items.find((i) => i.id === comparing && i.done);
  const codec = CODECS.find((c) => c.id === settings.codec)!;

  return (
    <Page
      title="Compress Video"
      subtitle="Shrink videos on this device. Each result is measured against the original before you download it."
      actions={
        <>
          <Button onClick={() => fileRef.current?.click()}><Upload size={14} /> Add videos</Button>
          <Button variant="primary" disabled={!finished.length || downloading} loading={downloading} onClick={saveAll}><Download size={14} /> Download all ({finished.length})</Button>
        </>
      }
    >
      <input ref={fileRef} type="file" accept={[...VIDEO_TYPES, ".mov", ".mkv"].join(",")} multiple hidden onChange={(e) => { if (e.target.files) add(Array.from(e.target.files)); e.target.value = ""; }} />
      <div ref={attach} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
          className={cn("min-h-[320px] min-w-0 rounded-xl border border-dashed p-4 transition-colors", over ? "border-accent bg-accent-soft" : "border-line")}
        >
          {finished.length > 0 && (
            <p className="mb-3 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs">
              <CheckCircle2 size={14} className="text-success" />
              {formatBytes(before)} → {formatBytes(after)}: saved {formatBytes(before - after)} ({Math.round((1 - after / before) * 100)}%) across {finished.length} video{finished.length > 1 ? "s" : ""}.
            </p>
          )}
          {items.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center text-center">
              <Film size={30} className="mb-3 text-muted" />
              <p className="text-sm font-medium">Drop videos here</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">MP4, MOV, WebM or MKV, up to 4 GB each, as long as this browser can decode them. Your originals are never changed, and nothing is uploaded.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {items.map((it) => (
                <Row key={it.id} it={it} onCancel={() => cancel(it.id)} onRemove={() => remove(it.id)} onRetry={() => requeue(it)} onSave={() => save(it)} onCompare={() => setComparing(it.id)} />
              ))}
            </ul>
          )}
          {pending > 0 && <p className="mt-3 text-[11px] text-muted">{pending} video{pending > 1 ? "s" : ""} waiting or in progress, one at a time. Keep this tab open until they finish.</p>}
        </div>

        <aside className="h-fit rounded-xl border border-line bg-panel p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Goal</h2>
          <ul className="space-y-1">
            {GOALS.map((g) => (
              <li key={g.id}>
                <button aria-pressed={settings.goal === g.id} onClick={() => set({ goal: g.id })} className={cn("w-full rounded-md border px-2.5 py-1.5 text-left", settings.goal === g.id ? "border-accent bg-accent-soft" : "border-line hover:border-muted/60")}>
                  <span className="block text-xs font-medium">{g.label}</span>
                  <span className="block text-[11px] leading-snug text-muted">{g.desc}</span>
                </button>
              </li>
            ))}
          </ul>
          {settings.goal === "size" && (
            <div className="mt-2">
              <Field label="Target size (MB)"><NumberInput value={settings.targetMB} min={1} max={4000} step={1} onChange={(v) => set({ targetMB: v })} /></Field>
              <div className="mt-1 flex gap-1">
                {SIZE_CHIPS.map((mb) => (
                  <button key={mb} aria-pressed={settings.targetMB === mb} onClick={() => set({ targetMB: mb })} className={cn("flex-1 rounded-md border py-1 text-[11px]", settings.targetMB === mb ? "border-accent text-accent" : "border-line text-muted hover:text-fg")}>{mb} MB</button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">Counted as 1,000,000 bytes per MB, the stricter reading, so the file fits however a site counts.</p>
            </div>
          )}

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Format</h2>
          {codecs === null ? (
            <p className="flex items-center gap-2 py-1 text-xs text-muted"><Spinner size={13} /> Checking which encoders this device has</p>
          ) : codecs.length === 0 ? (
            <p className="text-xs text-danger">This browser has no video encoder (WebCodecs). Use a current Chrome or Edge.</p>
          ) : (
            <>
              <Select<CodecId> label="Format" className="w-full" value={settings.codec} onChange={(v) => set({ codec: v })} options={CODECS.filter((c) => codecs.includes(c.id)).map((c) => ({ value: c.id, label: c.label }))} />
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{codec.note}</p>
              {codecs.length < CODECS.length && <p className="mt-1 text-[11px] text-muted">Not available in this browser: {CODECS.filter((c) => !codecs.includes(c.id)).map((c) => c.label.split(" ·")[0]).join(", ")}.</p>}
            </>
          )}

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Resolution</h2>
          <Select label="Resolution" className="w-full" value={String(settings.maxEdge ?? "original")} onChange={(v) => set({ maxEdge: v === "original" ? null : Number(v) })} options={[{ value: "original", label: "Keep original" }, ...EDGES.map((e) => ({ value: String(e), label: `Up to ${e === 2160 ? "4K" : `${e}p`}` }))]} />
          <p className="mt-1 text-[11px] leading-relaxed text-muted">Never upscales. {settings.goal === "size" && settings.maxEdge === null ? "With a size target, a smaller resolution is chosen automatically when the budget is too tight for the original." : "Lowering the resolution saves the most space, but fine detail is lost."}</p>

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Audio</h2>
          <Field label="Keep audio"><Toggle label="Keep audio" checked={settings.keepAudio} onChange={(v) => set({ keepAudio: v })} /></Field>
          <p className="text-[11px] leading-relaxed text-muted">Compressed audio is copied untouched when the format allows it; otherwise it is re-encoded at high quality.</p>

          <p className="mt-5 flex gap-2 rounded-lg bg-panel-2 p-2.5 text-[11px] leading-relaxed text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
            Runs entirely on this device. Results that would not be smaller are discarded, so you never get a bigger file.
          </p>
          <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => set({ ...DEFAULT_COMPRESS, codec: codecs?.includes("avc") ? "avc" : (codecs?.[0] ?? "avc") })}>Reset settings</Button>
        </aside>
      </div>
      {comparedItem && <FrameCompare original={comparedItem.file} compressed={comparedItem.done!.result.blob} title={comparedItem.name} onClose={() => setComparing(null)} />}
    </Page>
  );
}

function Row({ it, onCancel, onRemove, onRetry, onSave, onCompare }: { it: Item; onCancel: () => void; onRemove: () => void; onRetry: () => void; onSave: () => void; onCompare: () => void }) {
  const running = it.status === "working" || it.status === "checking";
  const d = it.done;
  const q = d?.quality ? verdict(d.quality.mean) : null;
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-panel p-2.5">
      <span className="flex h-[72px] w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-panel-3 bg-cover bg-center" style={it.probe?.poster ? { backgroundImage: `url(${it.probe.poster})` } : undefined}>
        {!it.probe?.poster && <Film size={18} className="text-muted" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={it.file.name}>{it.name}</p>
            <p className="truncate font-mono text-[10.5px] text-muted">
              {it.probe ? describe(it.probe) : formatBytes(it.file.size)}
              {it.probe?.hdr && <span className="ml-1.5 rounded bg-warn/15 px-1 text-warn">HDR</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {d && <Button size="sm" variant="primary" onClick={onSave}><Download size={13} /> Download</Button>}
            {d && <IconButton label="Compare with the original" onClick={onCompare}><SplitSquareHorizontal size={15} /></IconButton>}
            {running && <IconButton label="Cancel" onClick={onCancel}><X size={15} /></IconButton>}
            {it.probe && ["done", "kept", "error", "cancelled"].includes(it.status) && <IconButton label="Compress again with the current settings" onClick={onRetry}><RotateCcw size={14} /></IconButton>}
            <IconButton label={`Remove ${it.name}`} onClick={onRemove}><Trash2 size={14} /></IconButton>
          </div>
        </div>

        <div className="mt-1.5 text-xs">
          {it.status === "reading" && <p className="flex items-center gap-2 text-muted"><Spinner size={13} /> Reading the file</p>}
          {it.status === "queued" && <p className="text-muted">Waiting</p>}
          {running && (
            <div className="max-w-md">
              <div className="mb-1 flex justify-between text-[11px] text-muted"><span>{it.stage}</span><span className="font-mono">{Math.round((it.progress ?? 0) * 100)}%</span></div>
              <Progress value={it.progress ?? 0} />
            </div>
          )}
          {(it.status === "error" || it.status === "cancelled") && <p className={cn("flex items-start gap-1.5", it.status === "error" ? "text-danger" : "text-muted")}>{it.status === "error" && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}{it.message}</p>}
          {it.status === "kept" && <p className="flex items-start gap-1.5 text-muted"><Info size={13} className="mt-0.5 shrink-0" />{it.message}</p>}
          {d && (
            <div className="space-y-1">
              <p>
                <span className="font-medium">{formatBytes(it.file.size)} → {formatBytes(d.result.blob.size)}</span>
                <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 font-mono text-[11px] text-success">−{Math.round((1 - d.result.blob.size / it.file.size) * 100)}%</span>
                <span className="ml-2 text-[11px] text-muted">
                  {CODECS.find((c) => c.id === d.settings.codec)?.label} · {d.result.width}×{d.result.height} · audio {d.result.audio === "none" ? "removed" : d.result.audio} · {Math.max(1, Math.round(d.result.seconds))} s{it.probe ? ` (${(it.probe.duration / d.result.seconds).toFixed(1)}× real time)` : ""}
                </span>
              </p>
              {d.quality && q && (
                <p className={cn("flex items-center gap-1.5", q.tone === "good" ? "text-success" : q.tone === "warn" ? "text-warn" : "text-danger")}>
                  {q.tone === "good" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {q.label}
                  <span className="text-[11px] text-muted">SSIM {d.quality.mean.toFixed(3)}, lowest frame {d.quality.min.toFixed(3)}, {d.quality.samples} frames compared at full detail</span>
                </p>
              )}
              {d.qualityError && <p className="text-[11px] text-muted">Quality check unavailable: {d.qualityError} Use Compare to check by eye.</p>}
              {d.result.overTarget && <p className="text-[11px] text-warn">Still above the {d.settings.targetMB} MB target after a second pass. Try a lower resolution or a larger target.</p>}
              {d.result.passes > 1 && !d.result.overTarget && <p className="text-[11px] text-muted">A second pass was used to fit the {d.settings.targetMB} MB target.</p>}
              {d.result.audioNote && <p className="text-[11px] text-warn">{d.result.audioNote}</p>}
              {it.probe?.hdr && <p className="text-[11px] text-warn">HDR source: the result may not keep HDR, so colours can look flatter. Check with Compare before replacing the original.</p>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
