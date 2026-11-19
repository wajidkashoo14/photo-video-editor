import { db } from "@/lib/db";

/** Brand colours shared with every colour picker. Loaded once, kept in memory, persisted to IndexedDB. */
let colors: string[] = [];
let loaded = false;
const subs = new Set<() => void>();

export const DEFAULT_BRAND = ["#7c6cff", "#111118", "#ffffff", "#ffb84d"];

export function brandColors(): string[] {
  if (!loaded && typeof indexedDB !== "undefined") {
    loaded = true;
    db.get<string[]>("brand-colors")
      .then((c) => {
        colors = c ?? [];
        subs.forEach((f) => f());
      })
      .catch(() => {});
  }
  return colors;
}

export function setBrandColors(next: string[]) {
  colors = next;
  loaded = true;
  subs.forEach((f) => f());
  return db.set("brand-colors", next);
}

export const onBrandChange = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
