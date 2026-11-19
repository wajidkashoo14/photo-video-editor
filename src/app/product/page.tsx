"use client";

import { AlertTriangle, Download, FolderDown, ImagePlus, PencilLine, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Page } from "@/components/AppShell";
import { Button, ColorInput, Field, IconButton, Progress, Select, Slider, Spinner, Toggle, toast } from "@/components/ui";
import { classifyFile } from "@/config/app";
import { db } from "@/lib/db";
import { useClientValue, usePageActivity } from "@/lib/hooks";
import { photoProjectFromImage } from "@/lib/photo/create";
import { MARKET_PRESETS } from "@/lib/presets";
import { DEFAULT_STUDIO, STUDIO_BACKGROUNDS, composeProduct, cutOutProduct, type Cutout, type StudioSettings } from "@/lib/product";
import { canvasToBlob, cn, downloadBlob, guardUnload, safeName, uid } from "@/lib/utils";

interface Item {
  id: string;
  name: string;
  file: File;
  status: "queued" | "working" | "done" | "error";
  stage?: string;
  progress?: number;
  error?: string;
  cutout?: Cutout;
  preview?: string;
}

type DirPicker = () => Promise<FileSystemDirectoryHandle>;
const hasDirectoryPicker = () => "showDirectoryPicker" in window;

export default function ProductStudioPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [presetId, setPresetId] = useState(MARKET_PRESETS[0].id);
  const [s, setS] = useState<StudioSettings>(DEFAULT_STUDIO);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const queue = useRef<Item[]>([]);
  const { attach, gone } = usePageActivity();
  const preset = MARKET_PRESETS.find((p) => p.id === presetId)!;
  const patch = useCallback((id: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  const add = (files: File[]) => {
    const next: Item[] = [];
    for (const f of files) {
      try {
        if (classifyFile(f) !== "image") throw new Error(`"${f.name}" is not an image.`);
        next.push({ id: uid(), name: f.name.replace(/\.\w+$/, ""), file: f, status: "queued" });
      } catch (e) {
        toast(e instanceof Error ? e.message : "Unsupported file.", "error");
      }
    }
    if (next.length) enqueue(next, true);
  };

  // One image at a time: the segmentation model is memory hungry. The batch carries on while
  // another page is open, and closing or reloading the tab asks first (guardUnload). If this page
  // is dropped, the cut-outs have nowhere to go, so the batch stops and says so.
  const pump = async () => {
    if (working.current) return;
    working.current = true;
    const release = guardUnload();
    for (let next = queue.current.shift(); next; next = queue.current.shift()) {
      if (gone()) {
        const n = 1 + queue.current.length;
        queue.current = [];
        toast(`Product Studio stopped with ${n} photo${n === 1 ? "" : "s"} unfinished: the page was unloaded after you opened other pages. Add ${n === 1 ? "it" : "them"} again to continue.`, "error");
        break;
      }
      const { id, file } = next;
      patch(id, { status: "working", stage: "Starting", progress: 0, error: undefined });
      try {
        const cutout = await cutOutProduct(file, (stage, f) => patch(id, { stage, progress: f }));
        patch(id, { status: "done", cutout });
      } catch (e) {
        patch(id, { status: "error", error: e instanceof Error ? e.message : "Processing failed." });
      }
    }
    working.current = false;
    release();
  };
  const enqueue = (list: Item[], isNew: boolean) => {
    queue.current.push(...list);
    if (isNew) setItems((cur) => [...cur, ...list]);
    else list.forEach((it) => patch(it.id, { status: "queued", error: undefined }));
    void pump();
  };
  const remove = (id: string) => {
    queue.current = queue.current.filter((q) => q.id !== id);
    setItems((l) => l.filter((x) => x.id !== id));
  };

  // Re-render previews whenever the shared settings change, so the whole batch stays consistent.
  const doneKey = items.filter((i) => i.cutout).map((i) => i.id).join(",");
  useEffect(() => {
    const t = setTimeout(() => {
      setItems((list) =>
        list.map((it) => {
          if (!it.cutout) return it;
          try {
            return { ...it, preview: composeProduct(it.cutout, preset, s, 420 / Math.max(preset.width, preset.height)).toDataURL("image/png") };
          } catch {
            return it;
          }
        }),
      );
    }, 60);
    return () => clearTimeout(t);
  }, [doneKey, preset, s]);

  const render = async (it: Item) => {
    const canvas = composeProduct(it.cutout!, preset, s);
    // Formats without alpha cannot hold a transparent backdrop, so PNG is used for it.
    const transparent = s.background === "transparent" || (s.background === "preset" && preset.background === "transparent");
    const format = transparent && preset.format === "jpeg" ? "png" : preset.format;
    const blob = await canvasToBlob(canvas, `image/${format}`, format === "png" ? undefined : 0.92);
    const filename = `${safeName(it.name)}-${preset.id}.${format === "jpeg" ? "jpg" : format}`;
    await db.putExport({ id: uid(), projectId: "", projectName: "Product Studio", kind: "product", filename, mime: blob.type, width: canvas.width, height: canvas.height, size: blob.size, createdAt: Date.now(), blob }).catch(() => {});
    return { blob, filename };
  };

  const exportAll = async (toFolder: boolean) => {
    const ready = items.filter((i) => i.cutout);
    if (!ready.length) return;
    let dir: FileSystemDirectoryHandle | null = null;
    if (toFolder) {
      try {
        dir = await (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker();
      } catch {
        return; // picker dismissed
      }
    }
    setExporting({ done: 0, total: ready.length });
    const release = guardUnload(); // the remaining files would be lost with the tab
    try {
      for (let i = 0; i < ready.length; i++) {
        const { blob, filename } = await render(ready[i]);
        if (dir) {
          const w = await (await dir.getFileHandle(filename, { create: true })).createWritable();
          await w.write(blob);
          await w.close();
        } else {
          downloadBlob(blob, filename);
          await new Promise((r) => setTimeout(r, 350)); // browsers drop downloads fired in the same tick
        }
        setExporting({ done: i + 1, total: ready.length });
      }
      toast(`Exported ${ready.length} image${ready.length > 1 ? "s" : ""} for ${preset.name}.`, "success");
    } catch (e) {
      toast(e instanceof Error ? `Export failed: ${e.message}` : "Export failed.", "error");
    } finally {
      release();
      setExporting(null);
    }
  };

  const openInEditor = async (it: Item) => {
    try {
      const blob = await canvasToBlob(it.cutout!.canvas, "image/png");
      router.push(await photoProjectFromImage(it.name, blob, { background: "transparent" }));
    } catch {
      toast("Could not open this product in the editor.", "error");
    }
  };

  const ready = items.filter((i) => i.cutout).length;
  const pending = items.filter((i) => i.status === "queued" || i.status === "working").length;
  const canPickFolder = useClientValue(hasDirectoryPicker, false);
  const set = (p: Partial<StudioSettings>) => setS((cur) => ({ ...cur, ...p }));

  return (
    <Page
      title="Product Studio"
      subtitle="Cut products out on this device, place them on a consistent backdrop and export marketplace-ready images in one batch."
      actions={
        <>
          <Button onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Add product photos</Button>
          {canPickFolder && <Button disabled={!ready || !!exporting} onClick={() => exportAll(true)}><FolderDown size={14} /> Save all to folder</Button>}
          <Button variant="primary" disabled={!ready || !!exporting} loading={!!exporting} onClick={() => exportAll(false)}><Download size={14} /> Download all ({ready})</Button>
        </>
      }
    >
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) add(Array.from(e.target.files)); e.target.value = ""; }} />
      <div ref={attach} className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
          className={cn("min-h-[320px] rounded-xl border border-dashed p-4 transition-colors", over ? "border-accent bg-accent-soft" : "border-line")}
        >
          {exporting && (
            <div className="mb-4">
              <div className="mb-1 flex justify-between text-xs"><span>Exporting</span><span className="font-mono">{exporting.done} / {exporting.total}</span></div>
              <Progress value={exporting.done / exporting.total} />
            </div>
          )}
          {items.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center text-center">
              <ImagePlus size={30} className="mb-3 text-muted" />
              <p className="text-sm font-medium">Drop product photos here</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">Add as many as you like. Each product is cut out with an on-device model, so only the background changes; the product&apos;s shape, artwork and colours are copied through untouched.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {items.map((it) => (
                <li key={it.id} className="group overflow-hidden rounded-lg border border-line bg-panel">
                  <div className="cs-checker relative flex aspect-square items-center justify-center">
                    {it.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.preview} alt={`${it.name} on ${preset.name} backdrop`} className="max-h-full max-w-full" />
                    ) : it.status === "error" ? (
                      <span className="flex flex-col items-center gap-2 bg-panel p-3 text-center text-[11px] text-danger"><AlertTriangle size={18} />{it.error}</span>
                    ) : (
                      <span className="flex w-4/5 flex-col items-center gap-2 rounded-md bg-panel/90 p-3 text-[11px] text-muted">
                        <Spinner />
                        {it.status === "queued" ? "Waiting" : it.stage}
                        {it.status === "working" && <Progress value={it.progress ?? 0} />}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{it.name}</span>
                    {it.cutout && (
                      <>
                        <IconButton className="h-6 w-6" label={`Download ${it.name}`} onClick={() => render(it).then((r) => downloadBlob(r.blob, r.filename)).catch(() => toast("Export failed.", "error"))}><Download size={13} /></IconButton>
                        <IconButton className="h-6 w-6" label={`Open ${it.name} in Photo Editor`} onClick={() => openInEditor(it)}><PencilLine size={13} /></IconButton>
                      </>
                    )}
                    {it.status === "error" && <IconButton className="h-6 w-6" label="Retry" onClick={() => enqueue([it], false)}><RotateCcw size={13} /></IconButton>}
                    <IconButton className="h-6 w-6" label={`Remove ${it.name}`} disabled={it.status === "working"} onClick={() => remove(it.id)}><Trash2 size={13} /></IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pending > 0 && <p className="mt-3 text-[11px] text-muted">{pending} photo{pending > 1 ? "s" : ""} still processing. The first one also downloads the model (about 95 MB).</p>}
        </div>

        <aside className="h-fit rounded-xl border border-line bg-panel p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Marketplace</h2>
          <ul className="space-y-1">
            {MARKET_PRESETS.map((p) => (
              <li key={p.id}>
                <button aria-pressed={p.id === presetId} onClick={() => setPresetId(p.id)} className={cn("w-full rounded-md border px-2.5 py-1.5 text-left", p.id === presetId ? "border-accent bg-accent-soft" : "border-line hover:border-muted/60")}>
                  <span className="flex justify-between text-xs font-medium"><span>{p.name}</span><span className="font-mono text-[10px] text-muted">{p.width}×{p.height}</span></span>
                  <span className="block text-[11px] text-muted">{p.note}</span>
                </button>
              </li>
            ))}
          </ul>

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Backdrop</h2>
          <Field label="Background">
            <Select label="Background" className="w-40" value={s.background} onChange={(v) => set({ background: v })} options={[{ value: "preset", label: `${preset.name} default` }, ...STUDIO_BACKGROUNDS.map((b) => ({ value: b.id, label: b.name })), { value: "custom", label: "Custom colour" }]} />
          </Field>
          {s.background === "custom" && <Field label="Colour"><ColorInput value={s.color} onChange={(v) => set({ color: v })} /></Field>}

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Placement</h2>
          <Slider label="Product size" min={30} max={98} def={Math.round(preset.fill * 100)} value={Math.round((s.fill ?? preset.fill) * 100)} format={(v) => `${v}%`} onChange={(v) => set({ fill: v / 100 })} />
          <Slider label="Vertical position" min={-25} max={25} def={0} value={Math.round(s.offsetY * 100)} onChange={(v) => set({ offsetY: v / 100 })} />

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Shadow</h2>
          <Field label="Style">
            <Select label="Shadow style" className="w-40" value={s.shadow} onChange={(v) => set({ shadow: v })} options={[{ value: "contact", label: "Contact (on a surface)" }, { value: "drop", label: "Soft drop" }, { value: "none", label: "None" }]} />
          </Field>
          {s.shadow !== "none" && <Slider label="Strength" min={5} max={100} def={45} value={Math.round(s.shadowStrength * 100)} onChange={(v) => set({ shadowStrength: v / 100 })} />}

          <h2 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Enhance</h2>
          <Field label="Balance exposure"><Toggle label="Balance exposure" checked={s.enhance} onChange={(v) => set({ enhance: v })} /></Field>
          <p className="text-[11px] leading-relaxed text-muted">Adjusts brightness range only. Hue and saturation are left alone so product colours stay true.</p>
          <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => setS(DEFAULT_STUDIO)}>Reset settings</Button>
        </aside>
      </div>
    </Page>
  );
}
