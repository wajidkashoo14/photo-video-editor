"use client";

import { Clapperboard, Copy, Image as ImageIcon, Pencil, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IconButton, Spinner, toast } from "@/components/ui";
import { db, type ProjectKind, type ProjectRecord } from "@/lib/db";
import { emptyDoc } from "@/lib/photo/types";
import { createProject, duplicateProject, listProjects, renameProject, restoreProject, trashProject } from "@/lib/projects";
import { timeAgo } from "@/lib/utils";
import { emptyVideoProject } from "@/lib/video/types";

/** Creates a project of the given kind and size and returns the editor URL. */
export async function newProject(kind: ProjectKind, name: string, width: number, height: number, fps = 30, background = "#ffffff"): Promise<string> {
  const data = kind === "photo" ? { doc: emptyDoc(width, height, background) } : { project: emptyVideoProject(width, height, fps) };
  const p = await createProject(kind, name, width, height, data);
  return `/${kind}?id=${p.id}`;
}

export function useNewProject() {
  const router = useRouter();
  return useCallback(
    (...args: Parameters<typeof newProject>) =>
      newProject(...args)
        .then((url) => router.push(url))
        .catch(() => toast("Could not create the project. Browser storage may be unavailable.", "error")),
    [router],
  );
}

export function ProjectGrid({ trashed = false, limit, kind, emptyText }: { trashed?: boolean; limit?: number; kind?: ProjectKind; emptyText?: string }) {
  const [items, setItems] = useState<ProjectRecord[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      listProjects({ trashed })
        .then((p) => setItems((kind ? p.filter((x) => x.kind === kind) : p).slice(0, limit)))
        .catch(() => setItems([])),
    [trashed, limit, kind],
  );
  useEffect(() => void reload(), [reload]);

  if (!items) return <div className="flex items-center gap-2 py-10 text-muted"><Spinner /> Loading projects</div>;
  if (!items.length) return <p className="rounded-xl border border-dashed border-line py-12 text-center text-[13px] text-muted">{emptyText ?? (trashed ? "The trash is empty." : "No projects yet. Create one to get started.")}</p>;

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
      {items.map((p) => (
        <li key={p.id} className="group overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-muted/60">
          <Link href={trashed ? "#" : `/${p.kind}?id=${p.id}`} aria-disabled={trashed} className="cs-checker block aspect-video bg-panel-2" onClick={(e) => trashed && e.preventDefault()}>
            {p.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumbnail} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="flex h-full items-center justify-center bg-panel-2 text-muted">{p.kind === "photo" ? <ImageIcon size={26} /> : <Clapperboard size={26} />}</span>
            )}
          </Link>
          <div className="flex items-center gap-1 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              {renaming === p.id ? (
                <input
                  autoFocus
                  aria-label="Project name"
                  defaultValue={p.name}
                  className="h-6 w-full rounded border border-accent bg-panel-2 px-1 text-[13px] outline-none"
                  onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.target as HTMLInputElement).blur()}
                  onBlur={(e) => renameProject(p.id, e.target.value).then(() => { setRenaming(null); reload(); })}
                />
              ) : (
                <p className="truncate text-[13px] font-medium">{p.name}</p>
              )}
              <p className="flex items-center gap-1 text-[11px] text-muted">
                {p.kind === "photo" ? <ImageIcon size={11} /> : <Clapperboard size={11} />}
                {p.width} × {p.height} · {timeAgo(p.updatedAt)}
              </p>
            </div>
            <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {trashed ? (
                <>
                  <IconButton label="Restore project" onClick={() => restoreProject(p.id).then(reload)}><RotateCcw size={14} /></IconButton>
                  <IconButton
                    label="Delete permanently"
                    onClick={() => {
                      if (confirm(`Permanently delete "${p.name}" and its media? This cannot be undone.`)) db.deleteProjectForever(p.id).then(reload);
                    }}
                  >
                    <Trash2 size={14} className="text-danger" />
                  </IconButton>
                </>
              ) : (
                <>
                  <IconButton label="Rename" onClick={() => setRenaming(p.id)}><Pencil size={14} /></IconButton>
                  <IconButton label="Duplicate" onClick={() => duplicateProject(p.id).then(reload).catch(() => toast("Could not duplicate the project.", "error"))}><Copy size={14} /></IconButton>
                  <IconButton label="Move to trash" onClick={() => trashProject(p.id).then(() => { reload(); toast("Moved to trash. You can restore it from My Projects."); })}><Trash2 size={14} /></IconButton>
                </>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
