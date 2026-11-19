"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Page } from "@/components/AppShell";
import { useNewProject } from "@/components/ProjectGrid";
import { Select, toast } from "@/components/ui";
import { DEFAULT_BRAND, brandColors, onBrandChange } from "@/lib/brand";
import { flattenDoc } from "@/lib/photo/render";
import { SOCIAL_PRESETS } from "@/lib/presets";
import { createProject } from "@/lib/projects";
import { TEMPLATES } from "@/lib/templates";

export default function TemplatesPage() {
  const router = useRouter();
  const create = useNewProject();
  const photoSizes = useMemo(() => SOCIAL_PRESETS.filter((p) => p.kind === "photo"), []);
  const [sizeId, setSizeId] = useState(photoSizes[0].id);
  const [palette, setPalette] = useState(DEFAULT_BRAND);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const size = photoSizes.find((p) => p.id === sizeId)!;

  useEffect(() => {
    const sync = () => {
      const c = brandColors();
      setPalette(DEFAULT_BRAND.map((d, i) => c[i] ?? d));
    };
    sync();
    return onBrandChange(sync);
  }, []);

  // Thumbnails are real renders of the template at the chosen size and palette.
  useEffect(() => {
    let dead = false;
    document.fonts.ready.then(() => {
      if (dead) return;
      const out: Record<string, string> = {};
      for (const t of TEMPLATES) out[t.id] = flattenDoc(t.build(size.width, size.height, palette), 300 / Math.max(size.width, size.height), true).toDataURL("image/webp", 0.8);
      setThumbs(out);
    });
    return () => {
      dead = true;
    };
  }, [size, palette]);

  const use = async (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    try {
      const doc = t.build(size.width, size.height, palette);
      const p = await createProject("photo", `${t.name} · ${size.platform} ${size.name}`, doc.width, doc.height, { doc });
      router.push(`/photo?id=${p.id}`);
    } catch {
      toast("Could not create the project from this template.", "error");
    }
  };

  return (
    <Page title="Templates" subtitle="Editable layouts that adapt to the size you pick and use your Brand Kit colours.">
      <div className="mb-5 flex items-center gap-2">
        <span className="text-xs text-muted">Canvas size</span>
        <Select label="Canvas size" value={sizeId} onChange={setSizeId} options={photoSizes.map((p) => ({ value: p.id, label: `${p.platform} ${p.name} · ${p.width}×${p.height}` }))} />
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button onClick={() => use(t.id)} className="group w-full overflow-hidden rounded-xl border border-line bg-panel text-left hover:border-accent/60">
              <span className="flex h-52 items-center justify-center bg-panel-2 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {thumbs[t.id] && <img src={thumbs[t.id]} alt="" className="max-h-full max-w-full rounded-sm shadow-lg" />}
              </span>
              <span className="block px-3 py-2">
                <span className="block text-[13px] font-medium">{t.name}</span>
                <span className="block text-[11px] text-muted">{t.category}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <h2 className="mb-3 mt-10 text-sm font-semibold">Blank canvases by platform</h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {SOCIAL_PRESETS.map((p) => (
          <li key={p.id}>
            <button onClick={() => create(p.kind, `${p.platform} ${p.name}`, p.width, p.height, p.fps)} className="flex w-full items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-left hover:border-accent/60">
              <span>
                <span className="block text-xs font-medium">{p.platform} · {p.name}</span>
                <span className="block font-mono text-[10px] text-muted">{p.width}×{p.height}{p.fps ? ` · ${p.fps} fps` : ""}</span>
              </span>
              <span className="rounded bg-panel-3 px-1.5 py-0.5 text-[10px] uppercase text-muted">{p.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
