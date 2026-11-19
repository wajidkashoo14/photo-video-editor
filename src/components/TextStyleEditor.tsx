"use client";

import { useEffect, useState } from "react";
import { ColorInput, Field, NumberInput, Select, Slider, Toggle } from "@/components/ui";
import { db } from "@/lib/db";
import { FONT_FAMILIES, registerFont, type TextStyle } from "@/lib/text";

export interface BrandFont { name: string; data: ArrayBuffer }
let brandFontsLoaded: Promise<string[]> | null = null;

/** Registers fonts uploaded in the Brand Kit so they can be drawn on canvas. */
export function loadBrandFonts(force = false): Promise<string[]> {
  if (!brandFontsLoaded || force) {
    brandFontsLoaded = db
      .get<BrandFont[]>("brand-fonts")
      .then(async (fonts) => {
        const names: string[] = [];
        for (const f of fonts ?? []) {
          try {
            await registerFont(f.name, f.data);
            names.push(f.name);
          } catch {
            /* skip fonts the browser rejects */
          }
        }
        return names;
      })
      .catch(() => []);
  }
  return brandFontsLoaded;
}

/** Shared text controls for photo text layers and video titles. */
export function TextStyleEditor({ style: s, onChange, onStart }: { style: TextStyle; onChange: (patch: Partial<TextStyle>, history: boolean) => void; onStart: () => void }) {
  const [custom, setCustom] = useState<string[]>([]);
  useEffect(() => void loadBrandFonts().then(setCustom), []);
  const fonts = [...custom, ...FONT_FAMILIES];
  const set = (patch: Partial<TextStyle>, history = true) => onChange(patch, history);
  return (
    <>
      <textarea
        aria-label="Text content"
        className="mb-2 h-20 w-full resize-y rounded-md border border-line bg-panel-2 p-2 text-xs outline-none focus:border-accent"
        value={s.text}
        onFocus={onStart}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => set({ text: e.target.value }, false)}
      />
      <Field label="Font">
        <Select label="Font" className="w-36" value={fonts.includes(s.fontFamily) ? s.fontFamily : fonts[0]} onChange={(v) => set({ fontFamily: v })} options={fonts} />
      </Field>
      <Field label="Size">
        <NumberInput value={Math.round(s.fontSize)} min={4} max={2000} onChange={(v) => set({ fontSize: v })} />
      </Field>
      <Field label="Weight">
        <Select label="Weight" className="w-24" value={String(s.fontWeight)} onChange={(v) => set({ fontWeight: Number(v) })} options={["300", "400", "500", "600", "700", "800", "900"]} />
      </Field>
      <Field label="Italic">
        <Toggle label="Italic" checked={s.italic} onChange={(v) => set({ italic: v })} />
      </Field>
      <Field label="Align">
        <Select label="Align" className="w-24" value={s.align} onChange={(v) => set({ align: v })} options={["left", "center", "right"]} />
      </Field>
      <Field label="Colour">
        <ColorInput value={s.color} onStart={onStart} onChange={(v) => set({ color: v }, false)} />
      </Field>
      <Slider label="Line height" min={0.8} max={2.5} step={0.05} def={1.15} value={s.lineHeight} onStart={onStart} onChange={(v) => set({ lineHeight: v }, false)} />
      <Slider label="Letter spacing" min={-10} max={60} def={0} value={s.letterSpacing} onStart={onStart} onChange={(v) => set({ letterSpacing: v }, false)} />
      <Slider label="Outline" min={0} max={40} def={0} value={s.strokeWidth} onStart={onStart} onChange={(v) => set({ strokeWidth: v }, false)} />
      {s.strokeWidth > 0 && (
        <Field label="Outline colour">
          <ColorInput value={s.stroke} onStart={onStart} onChange={(v) => set({ stroke: v }, false)} />
        </Field>
      )}
      <Field label="Shadow">
        <Toggle label="Shadow" checked={s.shadow} onChange={(v) => set({ shadow: v })} />
      </Field>
      {s.shadow && <Slider label="Shadow blur" min={0} max={80} def={12} value={s.shadowBlur} onStart={onStart} onChange={(v) => set({ shadowBlur: v }, false)} />}
      <Field label="Background">
        <Toggle label="Text background" checked={!!s.bg} onChange={(v) => set({ bg: v ? "#000000" : null })} />
      </Field>
      {s.bg && (
        <>
          <Field label="Background colour">
            <ColorInput value={s.bg.slice(0, 7)} onStart={onStart} onChange={(v) => set({ bg: v }, false)} />
          </Field>
          <Slider label="Padding" min={0} max={120} def={24} value={s.bgPadding} onStart={onStart} onChange={(v) => set({ bgPadding: v }, false)} />
          <Slider label="Corner radius" min={0} max={120} def={12} value={s.bgRadius} onStart={onStart} onChange={(v) => set({ bgRadius: v }, false)} />
        </>
      )}
    </>
  );
}
