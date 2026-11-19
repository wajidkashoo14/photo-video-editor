"use client";

import { Clapperboard, Image as ImageIcon, Package, Sparkles } from "lucide-react";
import Link from "next/link";
import { Page } from "@/components/AppShell";
import { ProjectGrid, useNewProject } from "@/components/ProjectGrid";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import { SOCIAL_PRESETS } from "@/lib/presets";

export default function Home() {
  const create = useNewProject();
  const tiles = [
    { title: "New photo", desc: "Layers, colour, retouching", icon: ImageIcon, onClick: () => create("photo", "Untitled photo", 1920, 1080) },
    { title: "New video", desc: "Multitrack timeline, grading, export", icon: Clapperboard, onClick: () => create("video", "Untitled video", 1920, 1080, 30) },
  ];
  const links = [
    { title: "Product Studio", desc: "Batch cut-outs for marketplaces", icon: Package, href: "/product" },
    { title: "AI Tools", desc: "Background removal and more", icon: Sparkles, href: "/ai" },
  ];
  const tile = "flex items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent/60 hover:bg-panel-2";
  return (
    <Page title={`Welcome to ${APP_NAME}`} subtitle={APP_TAGLINE}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.title} className={tile} onClick={t.onClick}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><t.icon size={19} /></span>
            <span><span className="block text-[13px] font-semibold">{t.title}</span><span className="block text-xs text-muted">{t.desc}</span></span>
          </button>
        ))}
        {links.map((t) => (
          <Link key={t.title} className={tile} href={t.href}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><t.icon size={19} /></span>
            <span><span className="block text-[13px] font-semibold">{t.title}</span><span className="block text-xs text-muted">{t.desc}</span></span>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-9 text-sm font-semibold">Start from a size</h2>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {SOCIAL_PRESETS.slice(0, 10).map((p) => (
          <button
            key={p.id}
            onClick={() => create(p.kind, `${p.platform} ${p.name}`, p.width, p.height, p.fps)}
            className="flex w-32 shrink-0 flex-col items-center rounded-xl border border-line bg-panel p-3 hover:border-accent/60"
          >
            <span className="flex h-16 items-center justify-center">
              <span className="rounded-sm border border-muted/50 bg-panel-3" style={{ width: p.width >= p.height ? 56 : (56 * p.width) / p.height, height: p.height > p.width ? 56 : (56 * p.height) / p.width }} />
            </span>
            <span className="mt-2 text-xs font-medium">{p.platform} {p.name}</span>
            <span className="font-mono text-[10px] text-muted">{p.width}×{p.height} · {p.kind}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 mt-9 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent projects</h2>
        <Link href="/projects" className="text-xs text-accent hover:underline">View all</Link>
      </div>
      <ProjectGrid limit={8} />
    </Page>
  );
}
