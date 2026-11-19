"use client";

import { CheckCircle2, CircleSlash } from "lucide-react";
import { useEffect, useState } from "react";
import { Page, applyTheme } from "@/components/AppShell";
import { Button, Progress, Select, toast } from "@/components/ui";
import { APP_NAME } from "@/config/app";
import { storageEstimate } from "@/lib/db";
import { useClientValue } from "@/lib/hooks";
import { formatBytes } from "@/lib/utils";

type Caps = Record<string, { available: boolean; provider: string | null; needs: string[] }>;
const CAP_LABEL: Record<string, string> = { "text-to-image": "Text to image", "image-edit": "Generative image edit", transcribe: "Speech to text (subtitles)" };

const readTheme = () => {
  try {
    return localStorage.getItem("cs-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};
const readCodecs = () =>
  typeof VideoEncoder === "undefined"
    ? "WebCodecs is not available: video export will not work in this browser."
    : "WebCodecs is available: video export uses the device encoder, hardware accelerated where supported.";

export default function SettingsPage() {
  const storedTheme = useClientValue(readTheme, "dark");
  const [chosen, setChosen] = useState<string | null>(null);
  const theme = chosen ?? storedTheme;
  const codecs = useClientValue(readCodecs, null);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [caps, setCaps] = useState<Caps | null | "error">(null);

  useEffect(() => {
    storageEstimate().then(setEst);
    navigator.storage?.persisted?.().then(setPersisted);
    fetch("/api/ai/status").then((r) => r.json()).then((d) => setCaps(d.capabilities)).catch(() => setCaps("error"));
  }, []);

  const changeTheme = (t: string) => {
    setChosen(t);
    applyTheme(t);
    try {
      localStorage.setItem("cs-theme", t);
    } catch {
      toast("Your browser blocked saving this preference.", "error");
    }
  };

  const card = "rounded-xl border border-line bg-panel p-5";
  return (
    <Page title="Settings">
      <div className="grid max-w-3xl gap-4">
        <section className={card}>
          <h2 className="text-sm font-semibold">Appearance</h2>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-muted">Theme</span>
            <Select label="Theme" value={theme} onChange={changeTheme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          </div>
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">Storage</h2>
          <p className="mb-3 mt-1 text-xs text-muted">Projects and media are stored in this browser (IndexedDB). Clearing site data deletes them.</p>
          {est ? (
            <>
              <Progress value={est.quota ? est.usage / est.quota : 0} />
              <p className="mt-2 font-mono text-[11px] text-muted">{formatBytes(est.usage)} used of {formatBytes(est.quota)} available</p>
            </>
          ) : (
            <p className="text-xs text-muted">This browser does not report storage usage.</p>
          )}
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-muted">{persisted ? "Storage is protected from automatic eviction." : "The browser may evict data when the disk is low."}</span>
            {persisted === false && (
              <Button size="sm" onClick={() => navigator.storage.persist().then((ok) => { setPersisted(ok); toast(ok ? "Storage is now persistent." : "The browser declined. It usually grants this to installed or frequently used sites.", ok ? "success" : "info"); })}>
                Request persistent storage
              </Button>
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">AI providers</h2>
          <p className="mb-3 mt-1 text-xs text-muted">Background removal, auto colour and smart crop run on this device. Cloud features need a key in the server&apos;s environment (see .env.example); keys are never sent to the browser.</p>
          {caps === null ? <p className="text-xs text-muted">Checking</p> : caps === "error" ? <p className="text-xs text-danger">Could not reach the server to check provider status.</p> : (
            <ul className="space-y-2">
              {Object.entries(caps).map(([id, c]) => (
                <li key={id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">{c.available ? <CheckCircle2 size={14} className="text-success" /> : <CircleSlash size={14} className="text-muted" />}{CAP_LABEL[id] ?? id}</span>
                  <span className="font-mono text-[11px] text-muted">{c.available ? `via ${c.provider}` : `set ${c.needs.join(" or ")}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">This device</h2>
          <p className="mt-2 text-xs text-muted">{codecs}</p>
          <p className="mt-3 text-[11px] text-muted">{APP_NAME} · local-first build</p>
        </section>
      </div>
    </Page>
  );
}
