"use client";

import { Award, Brush, Crop, Eraser, FlipHorizontal2, FlipVertical2, Hand, ImagePlus, Maximize, Minus, MousePointer2, Plus, RotateCcw, RotateCw, Scaling, Shapes, SplitSquareHorizontal, Stamp, Type } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EditorTopBar } from "@/components/EditorTopBar";
import { Button, ColorInput, Field, IconButton, Modal, NumberInput, Select, Slider, Spinner, Tabs, Toggle, toast } from "@/components/ui";
import { db } from "@/lib/db";
import { addImageFiles, applyCrop, exportDoc, flipDoc, resizeDoc, rotateAll, rotateDoc90, type ImageExportOpts } from "@/lib/photo/actions";
import { emptyDoc, type ShapeKind } from "@/lib/photo/types";
import { ASPECTS } from "@/lib/presets";
import { createBlankProject } from "@/lib/projects";
import { clamp, cn, debounce, downloadBlob, formatBytes } from "@/lib/utils";
import { usePhoto, type Tool } from "@/stores/photoStore";
import { AdjustPanel, AIPanel, FiltersPanel, LayerPanel, LayersList } from "./Panels";
import { PhotoCanvas } from "./PhotoCanvas";

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "move", label: "Move & transform", key: "V", icon: <MousePointer2 size={17} /> },
  { tool: "hand", label: "Pan", key: "H", icon: <Hand size={17} /> },
  { tool: "crop", label: "Crop & straighten", key: "C", icon: <Crop size={17} /> },
  { tool: "text", label: "Text", key: "T", icon: <Type size={17} /> },
  { tool: "shape", label: "Shape", key: "U", icon: <Shapes size={17} /> },
  { tool: "brush", label: "Brush", key: "B", icon: <Brush size={17} /> },
  { tool: "eraser", label: "Eraser (masks the layer)", key: "E", icon: <Eraser size={17} /> },
  { tool: "clone", label: "Clone stamp", key: "S", icon: <Stamp size={17} /> },
];

function setTool(tool: Tool) {
  const s = usePhoto.getState();
  s.set({ tool, crop: tool === "crop" ? (s.crop ?? { x: 0, y: 0, w: s.doc.width, h: s.doc.height }) : null, cropAspect: tool === "crop" ? s.cropAspect : null });
}

function zoomBy(f: number | "fit" | "100") {
  const s = usePhoto.getState();
  if (f === "fit") return s.set({ fitNonce: s.fitNonce + 1 });
  const el = document.getElementById("photo-viewport");
  const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
  const zoom = f === "100" ? 1 : clamp(s.view.zoom * f, 0.02, 32);
  const k = zoom / s.view.zoom;
  s.set({ view: { zoom, x: cx - (cx - s.view.x) * k, y: cy - (cy - s.view.y) * k } });
}

/** Places the Brand Kit logo on the canvas as a new image layer. */
async function addBrandLogo() {
  const blob = await db.get<Blob>("brand-logo").catch(() => undefined);
  if (!blob) return toast("No logo yet. Upload one in Brand Kit first.", "info");
  const errs = await addImageFiles([new File([blob], "Brand logo.png", { type: blob.type })]);
  errs.forEach((m) => toast(m, "error"));
}

/* ---------- options bar ---------- */
/** Mounted only while cropping, so the angle starts from zero each time the tool is opened. */
function Straighten() {
  const [angle, setAngle] = useState(0);
  return (
    <div className="w-44">
      <Slider
        label="Straighten"
        min={-45}
        max={45}
        step={0.5}
        value={angle}
        format={(v) => `${v.toFixed(1)}°`}
        onStart={usePhoto.getState().snapshot}
        onChange={(v) => {
          rotateAll(v - angle, false);
          setAngle(v);
        }}
      />
    </div>
  );
}

function OptionsBar({ onPickImage, onResize }: { onPickImage: () => void; onResize: () => void }) {
  const tool = usePhoto((s) => s.tool);
  const brush = usePhoto((s) => s.brush);
  const shapeKind = usePhoto((s) => s.shapeKind);
  const crop = usePhoto((s) => s.crop);
  const cropAspect = usePhoto((s) => s.cropAspect);
  const doc = usePhoto((s) => s.doc);
  const { set } = usePhoto.getState();
  const setBrush = (patch: Partial<typeof brush>) => set({ brush: { ...brush, ...patch } });

  const pickAspect = (v: number | null | "original") => {
    const a = v === "original" ? doc.width / doc.height : v;
    let c = { x: 0, y: 0, w: doc.width, h: doc.height };
    if (a) {
      const w = Math.min(doc.width, doc.height * a), h = w / a;
      c = { x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h };
    }
    set({ cropAspect: a, crop: c });
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3 text-xs">
      {tool === "crop" && crop && (
        <>
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              onClick={() => pickAspect(a.value)}
              className={cn("rounded-md px-2 py-1", (a.value === "original" ? false : a.value === cropAspect) ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel-2 hover:text-fg")}
            >
              {a.label}
            </button>
          ))}
          <div className="h-5 w-px bg-line" />
          <Straighten />
          <span className="font-mono text-[11px] text-muted">{Math.round(crop.w)} × {Math.round(crop.h)}</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setTool("move")}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => applyCrop(crop)}>Apply crop</Button>
        </>
      )}
      {(tool === "brush" || tool === "eraser" || tool === "clone") && (
        <>
          <div className="w-40"><Slider label="Size" min={1} max={500} def={40} value={brush.size} onChange={(v) => setBrush({ size: v })} /></div>
          <div className="w-40"><Slider label="Opacity" min={1} max={100} def={100} value={Math.round(brush.opacity * 100)} onChange={(v) => setBrush({ opacity: v / 100 })} /></div>
          {tool === "brush" && <ColorInput label="Brush colour" value={brush.color} onChange={(v) => setBrush({ color: v })} />}
          {tool === "eraser" && <span className="text-muted">Erasing hides pixels with a mask; nothing is deleted.</span>}
          {tool === "clone" && <span className="text-muted">Alt-click to set the source, then paint over what you want to cover.</span>}
        </>
      )}
      {tool === "shape" && (
        <>
          <span className="text-muted">Shape</span>
          <Select<ShapeKind> label="Shape" value={shapeKind} onChange={(v) => set({ shapeKind: v })} options={[{ value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }, { value: "triangle", label: "Triangle" }, { value: "star", label: "Star" }, { value: "line", label: "Line" }]} />
          <span className="text-muted">Click the canvas to place it.</span>
        </>
      )}
      {tool === "text" && <span className="text-muted">Click the canvas to add text, then edit it in the Layer tab.</span>}
      {(tool === "move" || tool === "hand") && (
        <>
          <Button size="sm" onClick={onPickImage}><ImagePlus size={14} /> Add image</Button>
          <Button size="sm" variant="ghost" onClick={addBrandLogo}><Award size={14} /> Brand logo</Button>
          <div className="h-5 w-px bg-line" />
          <IconButton label="Rotate canvas 90° left" onClick={() => rotateDoc90(false)}><RotateCcw size={15} /></IconButton>
          <IconButton label="Rotate canvas 90° right" onClick={() => rotateDoc90(true)}><RotateCw size={15} /></IconButton>
          <IconButton label="Flip canvas horizontally" onClick={() => flipDoc("h")}><FlipHorizontal2 size={15} /></IconButton>
          <IconButton label="Flip canvas vertically" onClick={() => flipDoc("v")}><FlipVertical2 size={15} /></IconButton>
          <Button size="sm" variant="ghost" onClick={onResize}><Scaling size={14} /> Resize</Button>
          <div className="flex-1" />
          <span className="font-mono text-[11px] text-muted">{doc.width} × {doc.height} px</span>
        </>
      )}
    </div>
  );
}

/* ---------- dialogs ---------- */
function ResizeDialog({ onClose }: { onClose: () => void }) {
  const doc = usePhoto((s) => s.doc);
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [lock, setLock] = useState(true);
  const [scale, setScale] = useState(true);
  const ratio = doc.width / doc.height;
  return (
    <Modal title="Resize" onClose={onClose} width={360}>
      <Field label="Width (px)"><NumberInput value={w} min={1} max={16000} onChange={(v) => { setW(v); if (lock) setH(Math.round(v / ratio)); }} /></Field>
      <Field label="Height (px)"><NumberInput value={h} min={1} max={16000} onChange={(v) => { setH(v); if (lock) setW(Math.round(v * ratio)); }} /></Field>
      <Field label="Keep proportions"><Toggle label="Keep proportions" checked={lock} onChange={setLock} /></Field>
      <Field label="Scale the content"><Toggle label="Scale the content" checked={scale} onChange={setScale} /></Field>
      <p className="mt-1 text-[11px] text-muted">{scale ? "Layers are scaled with the canvas." : "Only the canvas changes; layers stay the same size, centred."}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { resizeDoc(w, h, scale); onClose(); }}>Resize</Button>
      </div>
    </Modal>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = usePhoto((s) => s.doc);
  const [o, setO] = useState<ImageExportOpts>({ format: doc.background === "transparent" ? "png" : "jpeg", quality: 0.92, scale: 1 });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await exportDoc(o);
      downloadBlob(r.blob, r.filename);
      setDone(`${r.filename} · ${r.width} × ${r.height} · ${formatBytes(r.blob.size)}`);
    } catch (e) {
      toast(e instanceof Error ? `Export failed: ${e.message}` : "Export failed.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Export image" onClose={onClose} width={380}>
      <Field label="Format">
        <Select label="Format" className="w-40" value={o.format} onChange={(v) => setO({ ...o, format: v })} options={[{ value: "png", label: "PNG (lossless, alpha)" }, { value: "jpeg", label: "JPEG" }, { value: "webp", label: "WebP" }]} />
      </Field>
      {o.format !== "png" && <Slider label="Quality" min={40} max={100} def={92} value={Math.round(o.quality * 100)} onChange={(v) => setO({ ...o, quality: v / 100 })} />}
      <Field label="Scale">
        <Select label="Scale" className="w-40" value={String(o.scale)} onChange={(v) => setO({ ...o, scale: Number(v) })} options={[0.25, 0.5, 1, 2].filter((s) => Math.max(doc.width, doc.height) * s <= 16000).map((s) => ({ value: String(s), label: `${s * 100}%` }))} />
      </Field>
      <p className="mt-2 font-mono text-[11px] text-muted">{Math.round(doc.width * o.scale)} × {Math.round(doc.height * o.scale)} px</p>
      {o.format === "jpeg" && doc.background === "transparent" && <p className="mt-2 text-[11px] text-warn">JPEG cannot store transparency; transparent areas will be white.</p>}
      {done && <p className="mt-3 rounded-md bg-panel-2 p-2 text-[11px] text-success">Exported {done}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" loading={busy} onClick={run}>Export</Button>
      </div>
    </Modal>
  );
}

/* ---------- editor ---------- */
type RightTab = "adjust" | "filters" | "layer" | "ai";

export function PhotoEditor() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<RightTab>("adjust");
  const [dialog, setDialog] = useState<"export" | "resize" | null>(null);
  const [panelW, setPanelW] = useState(300);
  const fileRef = useRef<HTMLInputElement>(null);

  const s = usePhoto();

  // Load (or create) the project.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (!id) {
          const p = await createBlankProject("photo", "Untitled photo", () => ({ doc: emptyDoc() }));
          if (!dead) router.replace(`/photo?id=${p.id}`);
          return;
        }
        const p = await db.getProject(id);
        if (!p || p.kind !== "photo") throw new Error("This photo project could not be found. It may have been deleted.");
        await usePhoto.getState().load(p);
        if (!dead) setReady(true);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "Could not open the project.");
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, router]);

  // Autosave shortly after the last change.
  useEffect(() => {
    const save = debounce(() => usePhoto.getState().save().catch(() => toast("Autosave failed. Your browser storage may be full.", "error")), 1500);
    const unsub = usePhoto.subscribe((st, prev) => {
      if (st.dirty && (st.doc !== prev.doc || st.name !== prev.name)) save();
    });
    return () => {
      unsub();
      save.cancel();
      if (usePhoto.getState().dirty) usePhoto.getState().save().catch(() => {});
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      const st = usePhoto.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? st.redo() : st.undo(); }
      if (mod && k === "y") { e.preventDefault(); st.redo(); return; }
      if (mod && k === "s") { e.preventDefault(); st.save().then(() => toast("Saved", "success")).catch(() => toast("Save failed.", "error")); return; }
      if (mod && k === "d") { e.preventDefault(); if (st.selectedId) st.duplicateLayer(st.selectedId); return; }
      if (mod && k === "0") { e.preventDefault(); zoomBy("fit"); return; }
      if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomBy(1.25); return; }
      if (mod && k === "-") { e.preventDefault(); zoomBy(0.8); return; }
      if (mod) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) return setTool(t.tool);
      if (k === "\\") return st.set({ compare: true });
      if (k === "[") return st.set({ brush: { ...st.brush, size: Math.max(1, Math.round(st.brush.size * 0.8)) } });
      if (k === "]") return st.set({ brush: { ...st.brush, size: Math.min(500, Math.round(st.brush.size * 1.25) + 1) } });
      if (k === "enter" && st.crop) return applyCrop(st.crop);
      if (k === "escape") return st.crop ? setTool("move") : st.set({ selectedId: null });
      if ((k === "delete" || k === "backspace") && st.selectedId) return st.removeLayer(st.selectedId);
      if (k.startsWith("arrow") && st.selectedId) {
        e.preventDefault();
        const l = st.doc.layers.find((x) => x.id === st.selectedId);
        if (!l || l.locked) return;
        const d = e.shiftKey ? 10 : 1;
        st.updateLayer(l.id, { x: l.x + (k === "arrowleft" ? -d : k === "arrowright" ? d : 0), y: l.y + (k === "arrowup" ? -d : k === "arrowdown" ? d : 0) });
      }
    };
    const up = (e: KeyboardEvent) => e.key === "\\" && usePhoto.getState().set({ compare: false });
    window.addEventListener("keydown", h);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Selecting a text or shape layer jumps to its properties.
  const selType = usePhoto((st) => st.doc.layers.find((l) => l.id === st.selectedId)?.type);
  const [prevSelType, setPrevSelType] = useState(selType);
  if (selType !== prevSelType) {
    setPrevSelType(selType);
    if (selType === "text" || selType === "shape") setTab("layer");
  }

  const startResize = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = panelW;
    const mv = (ev: PointerEvent) => setPanelW(clamp(w0 + x0 - ev.clientX, 240, 520));
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
  if (!ready)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Opening project
      </div>
    );

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
        onExport={() => setDialog("export")}
      >
        <IconButton label="Zoom out (Ctrl+-)" onClick={() => zoomBy(0.8)}><Minus size={15} /></IconButton>
        <button title="Zoom to 100%" className="w-12 rounded-md py-1 text-center font-mono text-[11px] text-muted hover:bg-panel-2 hover:text-fg" onClick={() => zoomBy("100")}>
          {Math.round(s.view.zoom * 100)}%
        </button>
        <IconButton label="Zoom in (Ctrl+=)" onClick={() => zoomBy(1.25)}><Plus size={15} /></IconButton>
        <IconButton label="Fit to screen (Ctrl+0)" onClick={() => zoomBy("fit")}><Maximize size={15} /></IconButton>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button
          size="sm"
          variant="ghost"
          active={s.compare}
          title="Hold to see the original (\)"
          onPointerDown={() => s.set({ compare: true })}
          onPointerUp={() => s.set({ compare: false })}
          onPointerLeave={() => s.compare && s.set({ compare: false })}
        >
          <SplitSquareHorizontal size={14} /> Before
        </Button>
      </EditorTopBar>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Tools" className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-panel py-2">
          {TOOLS.map((t) => (
            <IconButton key={t.tool} label={`${t.label} (${t.key})`} active={s.tool === t.tool} onClick={() => setTool(t.tool)}>
              {t.icon}
            </IconButton>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <OptionsBar onPickImage={() => fileRef.current?.click()} onResize={() => setDialog("resize")} />
          <div id="photo-viewport" className="relative min-h-0 flex-1">
            <PhotoCanvas />
            {s.doc.layers.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="pointer-events-auto rounded-xl border border-dashed border-line bg-panel/90 px-8 py-6 text-center">
                  <ImagePlus size={28} className="mx-auto mb-2 text-muted" />
                  <p className="text-sm font-medium">Drop a photo here</p>
                  <p className="mb-3 mt-1 text-xs text-muted">PNG, JPEG, WebP, AVIF or GIF</p>
                  <Button variant="primary" onClick={() => fileRef.current?.click()}>Choose image</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="w-1 shrink-0 cursor-col-resize bg-line/60 hover:bg-accent" onPointerDown={startResize} role="separator" aria-label="Resize panel" />
        <aside className="flex shrink-0 flex-col bg-panel" style={{ width: panelW }}>
          <Tabs<RightTab> value={tab} onChange={setTab} tabs={[{ value: "adjust", label: "Adjust" }, { value: "filters", label: "Filters" }, { value: "layer", label: "Layer" }, { value: "ai", label: "AI" }]} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "adjust" && <AdjustPanel />}
            {tab === "filters" && <FiltersPanel />}
            {tab === "layer" && <LayerPanel />}
            {tab === "ai" && <AIPanel />}
          </div>
          <div className="h-56 shrink-0 border-t border-line">
            <LayersList />
          </div>
        </aside>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addImageFiles(Array.from(e.target.files)).then((errs) => errs.forEach((m) => toast(m, "error")));
          e.target.value = "";
        }}
      />
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === "resize" && <ResizeDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
