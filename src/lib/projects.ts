import { db, type ProjectKind, type ProjectRecord } from "@/lib/db";
import { uid } from "@/lib/utils";

export async function createProject(kind: ProjectKind, name: string, width: number, height: number, data: unknown): Promise<ProjectRecord> {
  const now = Date.now();
  const p: ProjectRecord = { id: uid(), name, kind, createdAt: now, updatedAt: now, width, height, data };
  await db.putProject(p);
  return p;
}

const pendingBlank = new Map<ProjectKind, Promise<ProjectRecord>>();

/**
 * Creates the blank project an editor opens when it has no id. Calls made while one is being
 * created share it, so React's development double-mount does not leave an orphaned copy behind.
 */
export function createBlankProject(kind: ProjectKind, name: string, data: () => unknown): Promise<ProjectRecord> {
  let p = pendingBlank.get(kind);
  if (!p) {
    p = createProject(kind, name, 1920, 1080, data()).finally(() => pendingBlank.delete(kind));
    pendingBlank.set(kind, p);
  }
  return p;
}

export async function listProjects(opts: { trashed?: boolean } = {}): Promise<ProjectRecord[]> {
  const all = await db.listProjects();
  return all.filter((p) => !!p.deletedAt === !!opts.trashed).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameProject(id: string, name: string) {
  const p = await db.getProject(id);
  if (p) await db.putProject({ ...p, name: name.trim() || p.name, updatedAt: Date.now() });
}

/** Moves to trash (restorable). */
export async function trashProject(id: string) {
  const p = await db.getProject(id);
  if (p) await db.putProject({ ...p, deletedAt: Date.now() });
}

export async function restoreProject(id: string) {
  const p = await db.getProject(id);
  if (p) await db.putProject({ ...p, deletedAt: undefined });
}

/** Deep copy: assets get new ids and every reference inside the project data is remapped. */
export async function duplicateProject(id: string): Promise<ProjectRecord | null> {
  const p = await db.getProject(id);
  if (!p) return null;
  const assets = await db.listAssets(id);
  const newId = uid();
  let json = JSON.stringify(p.data);
  for (const a of assets) {
    const aid = uid();
    json = json.split(a.id).join(aid);
    await db.putAsset({ ...a, id: aid, projectId: newId });
  }
  const now = Date.now();
  const copy: ProjectRecord = { ...p, id: newId, name: `${p.name} copy`, createdAt: now, updatedAt: now, deletedAt: undefined, data: JSON.parse(json) };
  await db.putProject(copy);
  return copy;
}
