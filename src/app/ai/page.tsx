"use client";

import { Captions, Crop, Download, ImagePlus, KeyRound, PencilLine, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Page } from "@/components/AppShell";
import { Button, Progress, Select, Tabs, toast } from "@/components/ui";
import { classifyFile } from "@/config/app";
import { removeBackground } from "@/lib/ai/local";
import { photoProjectFromImage } from "@/lib/photo/create";
import { canvasToBlob, downloadBlob, makeCanvas } from "@/lib/utils";

type Caps = Record<string, { available: boolean; provider: string | null; needs: string[] }>;
type Tab = "remove" | "generate" | "edit";
const SIZES = [{ value: "1024x1024", label: "Square 1024×1024" }, { value: "1536x1024", label: "Landscape 1536×1024" }, { value: "1024x1536", label: "Portrait 1024×1536" }];

function NeedsKey({ cap }: { cap?: { available: boolean; needs: string[] } }) {
  if (!cap || cap.available) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed">
      <KeyRound size={15} className="mt-0.5 shrink-0 text-warn" />
      <span>
        This tool calls a cloud model and is switched off until the server has a key. Add <code className="rounded bg-panel-3 px-1 font-mono">{cap.needs.join(" or ")}</code> to <code className="rounded bg-panel-3 px-1 font-mono">.env.local</code> and restart the server. The key stays on the server.
      </span>
    </div>
  );
}

function ResultImage({ url, name, blob }: { url: string; name: string; blob: Blob }) {
  const router = useRouter();
  return (
    <div>
      <div className="cs-checker flex max-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Result" className="max-h-[420px] max-w-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => downloadBlob(blob, name)}><Download size={14} /> Download PNG</Button>
        <Button variant="primary" onClick={() => photoProjectFromImage(name.replace(/\.png$/, ""), blob, { background: "transparent" }).then((u) => router.push(u)).catch(() => toast("Could not create a project.", "error"))}>
          <PencilLine size={14} /> Open in Photo Editor
        </Button>
      </div>
    </div>
  );
}

function RemoveTool() {
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const [progress, setProgress] = useState<{ stage: string; f: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (file: File) => {
    try {
      if (classifyFile(file) !== "image") throw new Error("Choose an image file.");
      setResult(null);
      setProgress({ stage: "Starting", f: 0 });
      const matte = await removeBackground(file, (stage, f) => setProgress({ stage, f }));
      const bmp = await createImageBitmap(file);
      const out = makeCanvas(bmp.width, bmp.height);
      const ctx = out.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(matte, 0, 0, out.width, out.height);
      const blob = await canvasToBlob(out, "image/png");
      setResult({ url: URL.createObjectURL(blob), blob, name: `${file.name.replace(/\.\w+$/, "")}-cutout.png` });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Background removal failed.", "error");
    } finally {
      setProgress(null);
    }
  };
  return (
    <div>
      <p className="mb-4 text-xs leading-relaxed text-muted">Runs a segmentation model in this browser; your image is not uploaded. The first run downloads the model (about 95 MB).</p>
      <Button variant="primary" loading={!!progress} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Choose image</Button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) run(e.target.files[0]); e.target.value = ""; }} />
      {progress && (
        <div className="mt-4 max-w-sm">
          <div className="mb-1 flex justify-between text-xs text-muted"><span>{progress.stage}</span><span>{Math.round(progress.f * 100)}%</span></div>
          <Progress value={progress.f} />
        </div>
      )}
      {result && <div className="mt-5"><ResultImage {...result} /></div>}
    </div>
  );
}

function CloudTool({ mode, cap }: { mode: "generate" | "edit"; cap?: Caps[string] }) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [source, setSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = !!cap?.available && prompt.trim().length >= 3 && (mode === "generate" || !!source);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      let res: Response;
      if (mode === "generate") {
        res = await fetch("/api/ai/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, size }) });
      } else {
        // The provider expects PNG; re-encode whatever the user picked, capped at 2048 px.
        const bmp = await createImageBitmap(source!);
        const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
        const c = makeCanvas(bmp.width * k, bmp.height * k);
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        const form = new FormData();
        form.set("prompt", prompt);
        form.set("size", size);
        form.set("image", await canvasToBlob(c, "image/png"), "image.png");
        res = await fetch("/api/ai/edit", { method: "POST", body: form });
      }
      const data = (await res.json()) as { base64?: string; mime?: string; error?: string };
      if (!res.ok || !data.base64) throw new Error(data.error || "The request failed.");
      const blob = await (await fetch(`data:${data.mime};base64,${data.base64}`)).blob();
      setResult({ url: URL.createObjectURL(blob), blob, name: `${mode === "generate" ? "generated" : "edited"}-${Date.now()}.png` });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The request failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <NeedsKey cap={cap} />
      <fieldset disabled={!cap?.available || busy} className="max-w-xl space-y-3 disabled:opacity-60">
        {mode === "edit" && (
          <div className="flex items-center gap-3">
            <Button onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> {source ? "Change image" : "Choose image"}</Button>
            {source && <span className="truncate text-xs text-muted">{source.name}</span>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { classifyFile(f); setSource(f); } catch (err) { toast(err instanceof Error ? err.message : "Unsupported file.", "error"); } }} />
          </div>
        )}
        <textarea
          aria-label="Prompt"
          value={prompt}
          maxLength={2000}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={mode === "generate" ? "Describe the image you want, e.g. a ceramic mug on a linen tablecloth, soft morning light" : "Describe the change, e.g. replace the background with a sunlit marble counter"}
          className="h-28 w-full resize-y rounded-lg border border-line bg-panel-2 p-3 text-[13px] outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <Select label="Output size" value={size} onChange={setSize} options={SIZES} />
          <Button variant="primary" loading={busy} disabled={!ready} onClick={run}><Sparkles size={14} /> {mode === "generate" ? "Generate" : "Apply edit"}</Button>
        </div>
      </fieldset>
      {result && <div className="mt-5"><ResultImage {...result} /></div>}
    </div>
  );
}

export default function AIPage() {
  const [tab, setTab] = useState<Tab>("remove");
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json()).then((d) => setCaps(d.capabilities)).catch(() => setCaps({}));
  }, []);
  const more = [
    { icon: Wand2, title: "Auto colour", desc: "Histogram-based levels, white balance and gamma. Photo Editor → AI tab.", href: "/photo" },
    { icon: Crop, title: "Smart crop", desc: "Finds the most detailed region for any shape. Photo Editor → AI tab.", href: "/photo" },
    { icon: Captions, title: "Subtitles", desc: "Import an .srt file, or transcribe the timeline when a speech provider is configured. Video Editor → Text.", href: "/video" },
  ];
  return (
    <Page title="AI Tools" subtitle="On-device tools work offline. Cloud tools use a provider configured on the server.">
      <div className="rounded-xl border border-line bg-panel">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "remove", label: "Remove background · on device" }, { value: "generate", label: "Text to image · cloud" }, { value: "edit", label: "Generative edit · cloud" }]} />
        <div className="p-5">
          {tab === "remove" && <RemoveTool />}
          {tab === "generate" && <CloudTool key="g" mode="generate" cap={caps?.["text-to-image"]} />}
          {tab === "edit" && <CloudTool key="e" mode="edit" cap={caps?.["image-edit"]} />}
        </div>
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">Inside the editors</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {more.map((m) => (
          <Link key={m.title} href={m.href} className="rounded-xl border border-line bg-panel p-4 hover:border-accent/60">
            <m.icon size={17} className="text-accent" />
            <span className="mt-2 block text-[13px] font-medium">{m.title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{m.desc}</span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
