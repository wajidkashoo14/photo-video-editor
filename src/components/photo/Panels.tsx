"use client";

import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Image as ImageIcon, Lock, Paintbrush, Shapes, Sparkles, Trash2, Type, Unlock, Wand2, Crop as CropIcon, Eraser } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, ColorInput, Field, IconButton, NumberInput, Progress, Section, Select, Slider, TextInput, Toggle, toast } from "@/components/ui";
import { ADJ_GROUPS, DEFAULT_ADJ, GRADE_GROUP, LOOKS, LOOK_CATEGORIES, type Adjustments } from "@/lib/adjustments";
import { autoColor, removeBackground, smartCrop } from "@/lib/ai/local";
import { assetsVersion, getImage, newBitmap, onAssetsChanged } from "@/lib/assets";
import { db } from "@/lib/db";
import { getAdjustRenderer } from "@/lib/gl/adjust";
import { flattenDoc } from "@/lib/photo/render";
import { BLEND_MODES, blendLabel, type ImageLayer, type Layer, type ShapeLayer, type TextLayer } from "@/lib/photo/types";
import { ASPECTS } from "@/lib/presets";
import { TextStyleEditor } from "@/components/TextStyleEditor";
import { cn, makeCanvas } from "@/lib/utils";
import { usePhoto } from "@/stores/photoStore";

/** The image layer that colour tools act on: the selection, or the top image if nothing fitting is selected. */
export function useTargetImage(): ImageLayer | null {
  return usePhoto((s) => {
    const sel = s.doc.layers.find((l) => l.id === s.selectedId);
    if (sel?.type === "image") return sel;
    for (let i = s.doc.layers.length - 1; i >= 0; i--) if (s.doc.layers[i].type === "image") return s.doc.layers[i] as ImageLayer;
    return null;
  });
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted">{children}</p>;

/* ================= Adjust ================= */
interface SavedPreset { id: string; name: string; adjustments: Adjustments }

export function AdjustPanel() {
  const layer = useTargetImage();
  const { updateLayer, snapshot } = usePhoto.getState();
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  useEffect(() => void db.get<SavedPreset[]>("photo-presets").then((p) => setPresets(p ?? [])), []);
  if (!layer) return <Empty>Add a photo to start adjusting. Drop an image on the canvas or use the image button in the toolbar.</Empty>;
  const a = layer.adjustments;
  const setAdj = (patch: Partial<Adjustments>, history = false) => updateLayer(layer.id, { adjustments: { ...a, ...patch } } as Partial<Layer>, history);
  const savePresets = (next: SavedPreset[]) => {
    setPresets(next);
    db.set("photo-presets", next).catch(() => toast("Could not save presets.", "error"));
  };
  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="truncate text-xs text-muted">
          Editing <span className="text-fg">{layer.name}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => setAdj({ ...DEFAULT_ADJ }, true)}>
          Reset all
        </Button>
      </div>
      {ADJ_GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.items.map((it) => (
            <Slider key={it.key} label={it.label} min={it.min} max={it.max} value={a[it.key]} onStart={snapshot} onChange={(v) => setAdj({ [it.key]: v })} />
          ))}
        </Section>
      ))}
      <Section title="Grading" defaultOpen={false}>
        {GRADE_GROUP.filter((it) => it.key !== "gamma").map((it) => (
          <Slider key={it.key} label={it.label} min={it.min} max={it.max} value={a[it.key]} onStart={snapshot} onChange={(v) => setAdj({ [it.key]: v })} />
        ))}
      </Section>
      <Section title="Presets" defaultOpen={false}>
        <div className="flex gap-1.5">
          <TextInput className="min-w-0 flex-1" placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <Button
            size="sm"
            disabled={!presetName.trim()}
            onClick={() => {
              savePresets([...presets, { id: crypto.randomUUID(), name: presetName.trim(), adjustments: { ...a } }]);
              setPresetName("");
            }}
          >
            Save
          </Button>
        </div>
        {presets.length === 0 && <p className="mt-2 text-xs text-muted">Save the current sliders as a reusable preset.</p>}
        <ul className="mt-2 space-y-1">
          {presets.map((p) => (
            <li key={p.id} className="flex items-center gap-1">
              <button className="flex-1 truncate rounded-md bg-panel-2 px-2 py-1.5 text-left text-xs hover:bg-panel-3" onClick={() => setAdj({ ...DEFAULT_ADJ, ...p.adjustments }, true)}>
                {p.name}
              </button>
              <IconButton label={`Delete preset ${p.name}`} onClick={() => savePresets(presets.filter((x) => x.id !== p.id))}>
                <Trash2 size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/* ================= Filters ================= */
const thumbCache = new Map<string, Record<string, string>>();
const NO_THUMBS: Record<string, string> = {};

/** Renders every look on a tiny copy of the image. Cached per asset; returns nothing until the image is decoded. */
function lookThumbs(assetId: string | undefined): Record<string, string> {
  if (!assetId) return NO_THUMBS;
  const hit = thumbCache.get(assetId);
  if (hit) return hit;
  const img = getImage(assetId);
  if (!img) return NO_THUMBS;
  const k = 112 / Math.max(img.w, img.h);
  const small = makeCanvas(img.w * k, img.h * k);
  small.getContext("2d")!.drawImage(img.preview, 0, 0, small.width, small.height);
  const out = makeCanvas(small.width, small.height);
  const octx = out.getContext("2d")!;
  const gl = getAdjustRenderer();
  const res: Record<string, string> = {};
  for (const look of [{ id: "none" }, ...LOOKS]) {
    octx.clearRect(0, 0, out.width, out.height);
    octx.drawImage(gl.render(small, small.width, small.height, DEFAULT_ADJ, { filter: { id: look.id === "none" ? null : look.id, intensity: 100 } }), 0, 0);
    res[look.id] = out.toDataURL("image/jpeg", 0.72);
  }
  gl.forget(small);
  thumbCache.set(assetId, res);
  return res;
}

function FilterTile({ name, thumb, active, onClick }: { name: string; thumb?: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn("overflow-hidden rounded-md border text-left transition-colors", active ? "border-accent" : "border-line hover:border-muted")}>
      <span className="block aspect-[4/3] bg-panel-2 bg-cover bg-center" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
      <span className="block truncate px-1.5 py-1 text-[11px]">{name}</span>
    </button>
  );
}

export function FiltersPanel() {
  const layer = useTargetImage();
  const { updateLayer, snapshot } = usePhoto.getState();
  const [cat, setCat] = useState("All");
  // Re-evaluated when assets finish decoding, so thumbnails appear as soon as the image is ready.
  const version = useSyncExternalStore(onAssetsChanged, assetsVersion, () => 0);
  const thumbs = useMemo(() => (version >= 0 ? lookThumbs(layer?.assetId) : NO_THUMBS), [layer?.assetId, version]);
  if (!layer) return <Empty>Add a photo to browse filters.</Empty>;
  const list = cat === "All" ? LOOKS : LOOKS.filter((l) => l.category === cat);
  const setFilter = (id: string | null) => updateLayer(layer.id, { filter: { id, intensity: layer.filter.intensity } } as Partial<Layer>);
  return (
    <div>
      <div className="border-b border-line px-3 py-2">
        <Slider
          label="Intensity"
          min={0}
          max={100}
          def={100}
          value={layer.filter.intensity}
          onStart={snapshot}
          onChange={(v) => updateLayer(layer.id, { filter: { ...layer.filter, intensity: v } } as Partial<Layer>, false)}
        />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
        {["All", ...LOOK_CATEGORIES].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cn("rounded-full px-2 py-0.5 text-[11px]", cat === c ? "bg-accent text-white" : "bg-panel-2 text-muted hover:text-fg")}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        <FilterTile name="None" thumb={thumbs.none} active={layer.filter.id === null} onClick={() => setFilter(null)} />
        {list.map((l) => (
          <FilterTile key={l.id} name={l.name} thumb={thumbs[l.id]} active={layer.filter.id === l.id} onClick={() => setFilter(l.id)} />
        ))}
      </div>
    </div>
  );
}

/* ================= Layer properties ================= */
function TextProps({ layer }: { layer: TextLayer }) {
  const { updateLayer, snapshot } = usePhoto.getState();
  return (
    <Section title="Text">
      <TextStyleEditor style={layer.style} onStart={snapshot} onChange={(patch, history) => updateLayer(layer.id, { style: { ...layer.style, ...patch } } as Partial<Layer>, history)} />
    </Section>
  );
}

function ShapeProps({ layer }: { layer: ShapeLayer }) {
  const { updateLayer, snapshot } = usePhoto.getState();
  const set = (patch: Partial<ShapeLayer>, history = true) => updateLayer(layer.id, patch as Partial<Layer>, history);
  return (
    <Section title="Shape">
      <Field label="Fill">
        <ColorInput value={layer.fill} onStart={snapshot} onChange={(v) => set({ fill: v }, false)} />
      </Field>
      <Slider label="Border" min={0} max={60} def={0} value={layer.strokeWidth} onStart={snapshot} onChange={(v) => set({ strokeWidth: v }, false)} />
      {layer.strokeWidth > 0 && (
        <Field label="Border colour">
          <ColorInput value={layer.stroke} onStart={snapshot} onChange={(v) => set({ stroke: v }, false)} />
        </Field>
      )}
      {(layer.shape === "rect" || layer.shape === "line") && (
        <Slider label="Corner radius" min={0} max={Math.round(Math.min(layer.w, layer.h) / 2)} def={0} value={Math.min(layer.radius, Math.round(Math.min(layer.w, layer.h) / 2))} onStart={snapshot} onChange={(v) => set({ radius: v }, false)} />
      )}
    </Section>
  );
}

export function LayerPanel() {
  const layer = usePhoto((s) => s.doc.layers.find((l) => l.id === s.selectedId) ?? null);
  const background = usePhoto((s) => s.doc.background);
  const { updateLayer, snapshot, setDoc } = usePhoto.getState();
  const docSection = (
    <Section title="Canvas">
      <Field label="Transparent">
        <Toggle label="Transparent background" checked={background === "transparent"} onChange={(v) => setDoc((d) => ({ ...d, background: v ? "transparent" : "#ffffff" }))} />
      </Field>
      {background !== "transparent" && (
        <Field label="Background">
          <ColorInput value={background} onStart={snapshot} onChange={(v) => setDoc((d) => ({ ...d, background: v }), false)} />
        </Field>
      )}
    </Section>
  );
  if (!layer)
    return (
      <div>
        {docSection}
        <Empty>Select a layer to edit its properties.</Empty>
      </div>
    );
  const set = (patch: Partial<Layer>, history = true) => updateLayer(layer.id, patch, history);
  return (
    <div>
      <Section title="Layer">
        <Slider label="Opacity" min={0} max={100} def={100} value={Math.round(layer.opacity * 100)} onStart={snapshot} onChange={(v) => set({ opacity: v / 100 }, false)} />
        <Field label="Blend mode">
          <Select label="Blend mode" className="w-32" value={layer.blend} onChange={(v) => set({ blend: v })} options={BLEND_MODES.map((b) => ({ value: b, label: blendLabel(b) }))} />
        </Field>
      </Section>
      <Section title="Transform">
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="X"><NumberInput className="w-16" value={Math.round(layer.x)} onChange={(v) => set({ x: v })} /></Field>
          <Field label="Y"><NumberInput className="w-16" value={Math.round(layer.y)} onChange={(v) => set({ y: v })} /></Field>
          {layer.type !== "text" && (
            <>
              <Field label="W"><NumberInput className="w-16" min={1} value={Math.round(layer.w)} onChange={(v) => set(layer.type === "image" ? { w: v, h: (v * layer.h) / layer.w } : { w: v })} /></Field>
              <Field label="H"><NumberInput className="w-16" min={1} value={Math.round(layer.h)} onChange={(v) => set(layer.type === "image" ? { h: v, w: (v * layer.w) / layer.h } : { h: v })} /></Field>
            </>
          )}
        </div>
        <Slider label="Rotation" min={-180} max={180} def={0} value={Math.round(((((layer.rotation + 180) % 360) + 360) % 360) - 180)} onStart={snapshot} onChange={(v) => set({ rotation: v }, false)} format={(v) => `${v}°`} />
        <div className="mt-1 flex gap-1.5">
          <Button size="sm" active={layer.flipX} onClick={() => set({ flipX: !layer.flipX })}><FlipHorizontal2 size={13} /> Flip H</Button>
          <Button size="sm" active={layer.flipY} onClick={() => set({ flipY: !layer.flipY })}><FlipVertical2 size={13} /> Flip V</Button>
        </div>
      </Section>
      {layer.type === "text" && <TextProps layer={layer} />}
      {layer.type === "shape" && <ShapeProps layer={layer} />}
      {layer.type === "image" && (
        <Section title="Image">
          <Field label="Drop shadow">
            <Toggle label="Drop shadow" checked={layer.shadow.enabled} onChange={(v) => set({ shadow: { ...layer.shadow, enabled: v } } as Partial<Layer>)} />
          </Field>
          {layer.shadow.enabled && (
            <>
              <Slider label="Blur" min={0} max={200} def={40} value={layer.shadow.blur} onStart={snapshot} onChange={(v) => set({ shadow: { ...layer.shadow, blur: v } } as Partial<Layer>, false)} />
              <Slider label="Distance" min={0} max={200} def={24} value={layer.shadow.offsetY} onStart={snapshot} onChange={(v) => set({ shadow: { ...layer.shadow, offsetY: v } } as Partial<Layer>, false)} />
              <Slider label="Strength" min={0} max={100} def={35} value={Math.round(layer.shadow.opacity * 100)} onStart={snapshot} onChange={(v) => set({ shadow: { ...layer.shadow, opacity: v / 100 } } as Partial<Layer>, false)} />
            </>
          )}
          {layer.maskId && (
            <Button size="sm" className="mt-2 w-full" onClick={() => set({ maskId: null } as Partial<Layer>)}>
              Remove mask (restore erased pixels)
            </Button>
          )}
        </Section>
      )}
      {docSection}
    </div>
  );
}

/* ================= AI ================= */
function AICard({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">{icon}{title}</div>
      <p className="mb-2 mt-1 text-[11px] leading-relaxed text-muted">{desc}</p>
      {children}
    </div>
  );
}

export function AIPanel() {
  const layer = useTargetImage();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; f: number } | null>(null);
  const [aspect, setAspect] = useState("1");
  const { updateLayer, set } = usePhoto.getState();

  const runRemoveBg = async () => {
    if (!layer) return;
    setBusy("bg");
    try {
      const rec = await db.getAsset(layer.assetId);
      if (!rec) throw new Error("The original image could not be found.");
      const matte = await removeBackground(rec.blob, (stage, f) => setProgress({ stage, f }));
      const k = Math.min(1, 4096 / Math.max(matte.width, matte.height));
      const { id } = newBitmap(matte.width * k, matte.height * k, matte);
      updateLayer(layer.id, { maskId: id } as Partial<Layer>);
      toast("Background removed. The original pixels are kept; remove the mask in Layer to restore them.", "success");
    } catch (e) {
      toast(e instanceof Error ? `Background removal failed: ${e.message}` : "Background removal failed.", "error");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const runAuto = () => {
    if (!layer) return;
    const img = getImage(layer.assetId);
    if (!img) return;
    updateLayer(layer.id, { adjustments: { ...layer.adjustments, ...autoColor(img.preview) } } as Partial<Layer>);
    toast("Auto colour applied. Fine-tune it in Adjust.", "success");
  };

  const runSmartCrop = () => {
    const { doc } = usePhoto.getState();
    const flat = flattenDoc(doc, Math.min(1, 512 / Math.max(doc.width, doc.height)), true);
    const r = smartCrop(flat, Number(aspect));
    const k = doc.width / flat.width;
    set({ tool: "crop", cropAspect: Number(aspect), crop: { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k } });
    toast("Suggested crop placed. Adjust it, then press Enter to apply.");
  };

  return (
    <div className="space-y-2 p-3">
      <AICard icon={<Sparkles size={14} className="text-accent" />} title="Remove background" desc="Runs a segmentation model on this device. The first use downloads the model (about 95 MB).">
        <Button size="sm" variant="primary" className="w-full" disabled={!layer} loading={busy === "bg"} onClick={runRemoveBg}>
          Remove background
        </Button>
        {progress && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[11px] text-muted"><span>{progress.stage}</span><span>{Math.round(progress.f * 100)}%</span></div>
            <Progress value={progress.f} />
          </div>
        )}
      </AICard>
      <AICard icon={<Wand2 size={14} className="text-accent" />} title="Auto colour" desc="Analyses the histogram and sets levels, white balance and gamma. Editable afterwards.">
        <Button size="sm" className="w-full" disabled={!layer} onClick={runAuto}>Apply auto colour</Button>
      </AICard>
      <AICard icon={<CropIcon size={14} className="text-accent" />} title="Smart crop" desc="Finds the most detailed region for the chosen shape and places a crop you can refine.">
        <div className="flex gap-1.5">
          <Select label="Smart crop shape" className="flex-1" value={aspect} onChange={setAspect} options={ASPECTS.filter((a) => typeof a.value === "number").map((a) => ({ value: String(a.value), label: a.label }))} />
          <Button size="sm" onClick={runSmartCrop}>Suggest</Button>
        </div>
      </AICard>
      <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">
        Upscaling, generative fill, restoration and face enhancement need a cloud model. They live in <a className="text-accent hover:underline" href="/ai">AI Tools</a>, which shows whether a provider key is configured.
      </p>
    </div>
  );
}

/* ================= Layers list ================= */
const typeIcon = (l: Layer) => (l.type === "image" ? <ImageIcon size={13} /> : l.type === "text" ? <Type size={13} /> : l.type === "shape" ? <Shapes size={13} /> : l.name === "Clone" ? <Eraser size={13} /> : <Paintbrush size={13} />);

export function LayersList() {
  const layers = usePhoto((s) => s.doc.layers);
  const selectedId = usePhoto((s) => s.selectedId);
  const { updateLayer, removeLayer, duplicateLayer, reorderLayer, set } = usePhoto.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const ordered = useMemo(() => [...layers].reverse(), [layers]);
  const sel = layers.find((l) => l.id === selectedId);
  const idx = sel ? layers.indexOf(sel) : -1;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Layers</span>
        <span className="flex">
          <IconButton label="Bring forward" disabled={!sel || idx === layers.length - 1} onClick={() => sel && reorderLayer(sel.id, 1)}><ArrowUp size={14} /></IconButton>
          <IconButton label="Send backward" disabled={!sel || idx === 0} onClick={() => sel && reorderLayer(sel.id, -1)}><ArrowDown size={14} /></IconButton>
          <IconButton label="Duplicate layer (Ctrl+D)" disabled={!sel} onClick={() => sel && duplicateLayer(sel.id)}><Copy size={14} /></IconButton>
          <IconButton label="Delete layer (Del)" disabled={!sel} onClick={() => sel && removeLayer(sel.id)}><Trash2 size={14} /></IconButton>
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {ordered.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted">No layers yet</li>}
        {ordered.map((l) => (
          <li
            key={l.id}
            onClick={() => set({ selectedId: l.id })}
            className={cn("group flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs", l.id === selectedId ? "bg-accent-soft text-fg" : "text-muted hover:bg-panel-2")}
          >
            <button aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} title={l.visible ? "Hide" : "Show"} className="p-1 hover:text-fg" onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }); }}>
              {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            {typeIcon(l)}
            {renaming === l.id ? (
              <input
                autoFocus
                aria-label="Layer name"
                defaultValue={l.name}
                className="h-6 min-w-0 flex-1 rounded border border-accent bg-panel-2 px-1 text-xs outline-none"
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
                onBlur={(e) => { updateLayer(l.id, { name: e.target.value.trim() || l.name }); setRenaming(null); }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate" onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">{l.name}</span>
            )}
            <button aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} title={l.locked ? "Unlock" : "Lock"} className={cn("p-1 hover:text-fg", !l.locked && "opacity-0 group-hover:opacity-100")} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { locked: !l.locked }); }}>
              {l.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
