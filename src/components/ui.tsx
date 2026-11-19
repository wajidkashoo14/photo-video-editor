"use client";

import { ChevronDown, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { brandColors, onBrandChange } from "@/lib/brand";
import { cn } from "@/lib/utils";

const EMPTY: string[] = [];

/* ---------- Button ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  active?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, active, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-45",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-accent text-white hover:brightness-110",
        variant === "secondary" && "bg-panel-2 text-fg border border-line hover:bg-panel-3",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-panel-2",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        active && "bg-accent-soft text-accent border-accent/40",
        className,
      )}
    >
      {loading && <Loader2 size={14} className="cs-spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...p}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent",
        active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Slider ---------- */
export function Slider({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  def = 0,
  onChange,
  onStart,
  format,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  def?: number;
  onChange: (v: number) => void;
  /** Called once when a drag begins; use it to record an undo snapshot. */
  onStart?: () => void;
  format?: (v: number) => string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  const changed = value !== def;
  return (
    <div className="group py-1">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className={cn("text-muted", changed && "text-fg")}>{label}</span>
        <span className="flex items-center gap-1">
          {changed && (
            <button
              title={`Reset ${label}`}
              aria-label={`Reset ${label}`}
              className="text-muted opacity-0 hover:text-fg group-hover:opacity-100"
              onClick={() => {
                onStart?.();
                onChange(def);
              }}
            >
              <RotateCcw size={11} />
            </button>
          )}
          <span className="w-10 text-right font-mono text-[11px] tabular-nums text-fg">
            {format ? format(value) : step < 1 ? value.toFixed(2) : value}
          </span>
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        className="cs-range"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => onStart?.()}
        onKeyDown={(e) => e.key.startsWith("Arrow") && onStart?.()}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(def)}
      />
    </div>
  );
}

/* ---------- Fields ---------- */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex items-center justify-between gap-2 py-1 text-xs", className)}>
      <span className="shrink-0 text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-7 rounded-md border border-line bg-panel-2 px-2 text-xs text-fg outline-none focus:border-accent disabled:opacity-50";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  ...p
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  // Local text state so partial input ("-", "1.") does not get clobbered.
  const fmt = (v: number) => String(Number.isFinite(v) ? +v.toFixed(3) : 0);
  const [text, setText] = useState(fmt(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(fmt(value));
  }
  const commit = () => {
    let v = parseFloat(text);
    if (!Number.isFinite(v)) return setText(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
    setText(String(v));
  };
  return (
    <input
      {...p}
      type="number"
      step={step}
      className={cn(inputCls, "w-20 font-mono tabular-nums", className)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function TextInput({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, className)} onKeyDown={(e) => { e.stopPropagation(); p.onKeyDown?.(e); }} />;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[] | readonly T[];
  className?: string;
  label?: string;
}) {
  return (
    <select aria-label={label} className={cn(inputCls, "pr-6", className)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}

export function ColorInput({ value, onChange, onStart, label }: { value: string; onChange: (v: string) => void; onStart?: () => void; label?: string }) {
  const brand = useSyncExternalStore(onBrandChange, brandColors, () => EMPTY);
  return (
    <span className="flex items-center gap-1.5">
      {brand.slice(0, 5).map((c) => (
        <button
          key={c}
          type="button"
          title={`Brand colour ${c}`}
          aria-label={`Use brand colour ${c}`}
          className="h-4 w-4 rounded-full border border-line"
          style={{ background: c }}
          onClick={() => {
            onStart?.();
            onChange(c);
          }}
        />
      ))}
      <input
        type="color"
        aria-label={label ?? "Colour"}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
        onPointerDown={() => onStart?.()}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-8 cursor-pointer rounded border border-line bg-panel-2 p-0.5"
      />
      {brand.length === 0 && <span className="font-mono text-[11px] uppercase text-muted">{value}</span>}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[18px] w-8 rounded-full transition-colors", checked ? "bg-accent" : "bg-panel-3")}
    >
      <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all", checked ? "left-4" : "left-0.5")} />
    </button>
  );
}

/* ---------- Layout ---------- */
export function Section({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line">
      <div className="flex items-center justify-between px-3 py-2">
        <button className="flex flex-1 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg" onClick={() => setOpen(!open)}>
          <ChevronDown size={12} className={cn("transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: readonly { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors",
            value === t.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className="max-h-[90vh] w-full overflow-auto rounded-xl border border-line bg-panel shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="cs-spin text-muted" />;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-3" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; msg: string; kind: "info" | "error" | "success" };
let toasts: Toast[] = [];
const subs = new Set<() => void>();
export function toast(msg: string, kind: Toast["kind"] = "info") {
  const t = { id: Date.now() + Math.random(), msg, kind };
  toasts = [...toasts, t];
  subs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== t);
    subs.forEach((f) => f());
  }, kind === "error" ? 7000 : 3500);
}

export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto max-w-md rounded-lg border px-3.5 py-2 text-xs shadow-xl",
            t.kind === "error" ? "border-danger/40 bg-[#2a1218] text-[#ffb3c0]" : t.kind === "success" ? "border-success/40 bg-[#0f251c] text-[#9be8c6]" : "border-line bg-panel-2 text-fg",
          )}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
