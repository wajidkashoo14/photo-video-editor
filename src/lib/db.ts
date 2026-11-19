/**
 * Local-first persistence on IndexedDB. Projects store editing instructions (JSON);
 * original media is stored separately as Blobs in `assets`, so edits stay non-destructive.
 */
export type ProjectKind = "photo" | "video";

export interface ProjectRecord {
  id: string;
  name: string;
  kind: ProjectKind;
  createdAt: number;
  updatedAt: number;
  /** Set when the project is in the trash; restorable until purged. */
  deletedAt?: number;
  thumbnail?: string;
  width: number;
  height: number;
  data: unknown;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  kind: "image" | "video" | "audio" | "bitmap" | "font" | "lut";
  blob: Blob;
  meta?: Record<string, unknown>;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  projectName: string;
  kind: ProjectKind | "product";
  filename: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
  /** Kept so the file can be downloaded again from Export History. */
  blob?: Blob;
}

const NAME = "createstudio";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("assets")) {
        const s = db.createObjectStore("assets", { keyPath: "id" });
        s.createIndex("projectId", "projectId");
      }
      if (!db.objectStoreNames.contains("exports")) db.createObjectStore("exports", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        let out: T;
        if (r) r.onsuccess = () => (out = r.result);
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted (the disk may be full)."));
      }),
  );
}

export const db = {
  // projects
  listProjects: () => run<ProjectRecord[]>("projects", "readonly", (s) => s.getAll()),
  getProject: (id: string) => run<ProjectRecord | undefined>("projects", "readonly", (s) => s.get(id)),
  putProject: (p: ProjectRecord) => run("projects", "readwrite", (s) => void s.put(p)),
  async deleteProjectForever(id: string) {
    const assets = await db.listAssets(id);
    await run("assets", "readwrite", (s) => assets.forEach((a) => s.delete(a.id)));
    await run("projects", "readwrite", (s) => void s.delete(id));
  },
  // assets
  getAsset: (id: string) => run<AssetRecord | undefined>("assets", "readonly", (s) => s.get(id)),
  putAsset: (a: AssetRecord) => run("assets", "readwrite", (s) => void s.put(a)),
  deleteAsset: (id: string) => run("assets", "readwrite", (s) => void s.delete(id)),
  listAssets: (projectId: string) =>
    run<AssetRecord[]>("assets", "readonly", (s) => s.index("projectId").getAll(projectId)),
  // exports
  listExports: () => run<ExportRecord[]>("exports", "readonly", (s) => s.getAll()),
  putExport: (e: ExportRecord) => run("exports", "readwrite", (s) => void s.put(e)),
  deleteExport: (id: string) => run("exports", "readwrite", (s) => void s.delete(id)),
  // key-value (settings, presets, brand kit)
  get: <T>(key: string) => run<T | undefined>("kv", "readonly", (s) => s.get(key)),
  set: (key: string, value: unknown) => run("kv", "readwrite", (s) => void s.put(value, key)),
};

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
