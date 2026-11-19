import clsx, { type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);
export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function formatTime(sec: number, fps = 30): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps + 1e-6);
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function timeAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let unloadGuards = 0;
const confirmUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = true; // Chromium before 119 asks only when this is set
};

/**
 * For long work that lives only in this tab (a video export, a compression batch): until the
 * returned function is called, closing or reloading the tab makes the browser ask "Leave site?".
 * Moving between the app's own pages never asks, because those are not page unloads.
 */
export function guardUnload(): () => void {
  if (unloadGuards++ === 0) window.addEventListener("beforeunload", confirmUnload);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--unloadGuards === 0) window.removeEventListener("beforeunload", confirmUnload);
  };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), type, quality));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "untitled";
