"use client";

import { Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Page } from "@/components/AppShell";
import { loadBrandFonts, type BrandFont } from "@/components/TextStyleEditor";
import { Button, IconButton, toast } from "@/components/ui";
import { IMAGE_TYPES } from "@/config/app";
import { DEFAULT_BRAND, brandColors, onBrandChange, setBrandColors } from "@/lib/brand";
import { db } from "@/lib/db";

const ROLES = ["Accent", "Dark", "Light", "Highlight"];

export default function BrandPage() {
  const [colors, setColors] = useState<string[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [logo, setLogo] = useState<string | null>(null);
  const fontRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setColors([...brandColors()]);
    sync();
    loadBrandFonts().then(setFonts);
    db.get<Blob>("brand-logo").then((b) => b && setLogo(URL.createObjectURL(b))).catch(() => {});
    return onBrandChange(sync);
  }, []);

  const save = (next: string[]) => setBrandColors(next).catch(() => toast("Could not save brand colours.", "error"));

  const addFont = async (file: File) => {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) return toast("Upload a .ttf, .otf, .woff or .woff2 font.", "error");
    if (file.size > 10 * 1048576) return toast("Font files are limited to 10 MB.", "error");
    const name = file.name.replace(/\.\w+$/, "").replace(/[^\w ]+/g, " ").trim().slice(0, 40) || "Custom font";
    try {
      const data = await file.arrayBuffer();
      await new FontFace(name, data).load(); // validates before storing
      const list = (await db.get<BrandFont[]>("brand-fonts")) ?? [];
      await db.set("brand-fonts", [...list.filter((f) => f.name !== name), { name, data }]);
      setFonts(await loadBrandFonts(true));
      toast(`"${name}" is now available in every font list.`, "success");
    } catch {
      toast("That file is not a font the browser can load.", "error");
    }
  };

  const removeFont = async (name: string) => {
    const list = (await db.get<BrandFont[]>("brand-fonts")) ?? [];
    await db.set("brand-fonts", list.filter((f) => f.name !== name));
    setFonts(await loadBrandFonts(true));
  };

  const setLogoFile = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) return toast("Upload a PNG, JPEG, WebP, AVIF, GIF or BMP logo. PNG with transparency works best.", "error");
    if (file.size > 10 * 1048576) return toast("Logos are limited to 10 MB.", "error");
    await db.set("brand-logo", file);
    setLogo(URL.createObjectURL(file));
  };

  const card = "rounded-xl border border-line bg-panel p-5";
  return (
    <Page title="Brand Kit" subtitle="Colours and fonts saved here appear in every colour picker, font list and template.">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-sm font-semibold">Colours</h2>
          <p className="mb-4 mt-1 text-xs text-muted">The first four fill the template roles: {ROLES.join(", ")}.</p>
          <ul className="flex flex-wrap gap-3">
            {colors.map((c, i) => (
              <li key={i} className="group relative text-center">
                <input type="color" aria-label={`Brand colour ${i + 1}`} value={c} onChange={(e) => save(colors.map((x, j) => (j === i ? e.target.value : x)))} className="h-14 w-14 cursor-pointer rounded-lg border border-line bg-panel-2 p-1" />
                <span className="block font-mono text-[10px] uppercase text-muted">{c}</span>
                <span className="block text-[10px] text-muted">{ROLES[i] ?? ""}</span>
                <button aria-label={`Remove colour ${c}`} className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-panel-3 p-0.5 text-muted hover:text-fg group-hover:block" onClick={() => save(colors.filter((_, j) => j !== i))}><X size={11} /></button>
              </li>
            ))}
            <li>
              <button aria-label="Add brand colour" className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-line text-muted hover:border-accent hover:text-accent" onClick={() => save([...colors, DEFAULT_BRAND[colors.length] ?? "#888888"])}><Plus size={18} /></button>
            </li>
          </ul>
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">Logo</h2>
          <p className="mb-4 mt-1 text-xs text-muted">Stored in this browser. In the Photo Editor, Brand logo in the toolbar places it as a new layer.</p>
          <div className="flex items-center gap-4">
            <span className="cs-checker flex h-24 w-40 items-center justify-center overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo ? <img src={logo} alt="Brand logo" className="max-h-full max-w-full" /> : <span className="bg-panel px-2 py-1 text-[11px] text-muted">No logo</span>}
            </span>
            <div className="flex flex-col gap-2">
              <Button onClick={() => logoRef.current?.click()}><Upload size={14} /> Upload logo</Button>
              {logo && <Button variant="ghost" onClick={() => db.set("brand-logo", undefined).then(() => setLogo(null))}>Remove</Button>}
            </div>
          </div>
          <input ref={logoRef} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(e) => { if (e.target.files?.[0]) setLogoFile(e.target.files[0]); e.target.value = ""; }} />
        </section>

        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Fonts</h2>
              <p className="mt-1 text-xs text-muted">Upload TTF, OTF or WOFF files. Only use fonts you are licensed to use.</p>
            </div>
            <Button onClick={() => fontRef.current?.click()}><Upload size={14} /> Upload font</Button>
          </div>
          <input ref={fontRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => { if (e.target.files?.[0]) addFont(e.target.files[0]); e.target.value = ""; }} />
          {fonts.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-line py-8 text-center text-xs text-muted">No custom fonts yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {fonts.map((f) => (
                <li key={f} className="flex items-center justify-between py-2.5">
                  <span>
                    <span className="block text-xl" style={{ fontFamily: `"${f}"` }}>The quick brown fox jumps over the lazy dog</span>
                    <span className="text-[11px] text-muted">{f}</span>
                  </span>
                  <IconButton label={`Remove font ${f}`} onClick={() => removeFont(f)}><Trash2 size={14} /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}
