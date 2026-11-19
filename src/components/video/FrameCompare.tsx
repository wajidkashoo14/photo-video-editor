"use client";

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { useEffect, useRef, useState } from "react";
import { Modal, Slider, Spinner } from "@/components/ui";
import { clamp, cn } from "@/lib/utils";

interface Sinks { a: CanvasSink; b: CanvasSink; fa: number; fb: number }

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Before/after wipe between an original video and its compressed copy at any moment. Frames are
 * shown at the compressed file's resolution; at 100% every pixel is real, which is where
 * compression artefacts show first.
 */
export function FrameCompare({ original, compressed, title, onClose }: { original: Blob; compressed: Blob; title: string; onClose: () => void }) {
  const [info, setInfo] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [wipe, setWipe] = useState(50);
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  const [busy, setBusy] = useState(true);
  const sinks = useRef<Sinks | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const before = useRef<HTMLCanvasElement>(null);
  const after = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let dead = false;
    const inputs = [original, compressed].map((b) => new Input({ source: new BlobSource(b), formats: ALL_FORMATS }));
    (async () => {
      try {
        const [va, vb] = await Promise.all(inputs.map((i) => i.getPrimaryVideoTrack()));
        if (!va || !vb) throw new Error("A video track is missing.");
        const w = vb.displayWidth, h = vb.displayHeight;
        const same = va.displayWidth === w && va.displayHeight === h;
        const a = new CanvasSink(va, same ? { poolSize: 2 } : { width: w, height: h, fit: "fill", poolSize: 2 });
        const b = new CanvasSink(vb, { poolSize: 2 });
        const [fa, fb, end] = await Promise.all([va.getFirstTimestamp(), vb.getFirstTimestamp(), vb.computeDuration()]);
        if (dead) return;
        const duration = Math.max(0, end - fb);
        sinks.current = { a, b, fa, fb };
        setInfo({ w, h, duration });
        setT(+(duration * 0.3).toFixed(2)); // opening frames are often black
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "The videos could not be opened.");
      }
    })();
    return () => {
      dead = true;
      sinks.current = null;
      inputs.forEach((i) => i.dispose());
    };
  }, [original, compressed]);

  // Draw both frames for the chosen moment. Requests run one after another so pooled canvases are never reused mid-draw.
  useEffect(() => {
    if (!info) return;
    let stale = false;
    const timer = setTimeout(() => {
      setBusy(true);
      chain.current = chain.current.then(async () => {
        const s = sinks.current;
        if (stale || !s) return;
        try {
          const fa = await s.a.getCanvas(s.fa + t);
          if (fa && before.current && !stale) paint(before.current, fa.canvas, info.w, info.h);
          const fb = await s.b.getCanvas(s.fb + t);
          if (fb && after.current && !stale) paint(after.current, fb.canvas, info.w, info.h);
        } catch {
          // A failed seek leaves the previous frame on screen.
        } finally {
          if (!stale) setBusy(false);
        }
      });
    }, 80);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [t, info]);

  const wipeAt = (clientX: number) => {
    const r = area.current?.getBoundingClientRect();
    if (r) setWipe(clamp(((clientX - r.left) / r.width) * 100, 0, 100));
  };

  return (
    <Modal title={`Compare · ${title}`} onClose={onClose} width={1100}>
      {error ? (
        <p className="rounded-md bg-danger/10 p-3 text-xs text-danger">{error}</p>
      ) : !info ? (
        <div className="flex h-64 items-center justify-center"><Spinner /></div>
      ) : (
        <>
          {/* Labels sit on the viewer, not the frame, so they stay visible while scrolling at 100%. */}
          <div className="relative overflow-hidden rounded-lg border border-line bg-black">
            <div className={cn(zoom === "full" && "max-h-[60vh] overflow-auto")}>
              <div
                ref={area}
                className="relative mx-auto cursor-ew-resize touch-none select-none"
                style={zoom === "fit" ? { width: `min(100%, calc(60vh * ${info.w / info.h}))`, aspectRatio: `${info.w} / ${info.h}` } : { width: info.w, height: info.h }}
                onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); wipeAt(e.clientX); }}
                onPointerMove={(e) => dragging.current && wipeAt(e.clientX)}
                onPointerUp={() => { dragging.current = false; }}
              >
                <canvas ref={before} aria-label="Original frame" className="absolute inset-0 h-full w-full" />
                <canvas ref={after} aria-label="Compressed frame" className="absolute inset-0 h-full w-full" style={{ clipPath: `inset(0 0 0 ${wipe}%)` }} />
                <div className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]" style={{ left: `${wipe}%` }} />
              </div>
            </div>
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">Original</span>
            <span className="pointer-events-none absolute right-4 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">Compressed</span>
            {busy && <span className="pointer-events-none absolute bottom-4 right-4 rounded bg-black/65 p-1"><Spinner size={14} /></span>}
          </div>
          <div className="mt-3 grid gap-x-6 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <Slider label="Moment" min={0} max={Math.max(0.01, info.duration)} step={0.04} def={0} value={t} format={clock} onChange={setT} />
            <Slider label="Divider" min={0} max={100} def={50} value={Math.round(wipe)} format={(v) => `${v}%`} onChange={setWipe} />
            <div className="flex gap-1 py-1" role="group" aria-label="Zoom">
              {(["fit", "full"] as const).map((z) => (
                <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cn("rounded-md border px-2.5 py-1 text-xs", zoom === z ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}>
                  {z === "fit" ? "Fit" : "100%"}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted">Drag across the picture to move the divider. Both sides are shown at {info.w}×{info.h}; use 100% to inspect real pixels in fine detail, textures and dark areas.</p>
        </>
      )}
    </Modal>
  );
}

function paint(target: HTMLCanvasElement, src: HTMLCanvasElement | OffscreenCanvas, w: number, h: number) {
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  target.getContext("2d")!.drawImage(src, 0, 0, w, h);
}
