"use client";

import { Clapperboard, Download, Image as ImageIcon, Package, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/AppShell";
import { Button, IconButton, Spinner } from "@/components/ui";
import { db, type ExportRecord } from "@/lib/db";
import { downloadBlob, formatBytes, timeAgo } from "@/lib/utils";

export default function ExportsPage() {
  const [items, setItems] = useState<ExportRecord[] | null>(null);
  const reload = useCallback(() => db.listExports().then((e) => setItems(e.sort((a, b) => b.createdAt - a.createdAt))).catch(() => setItems([])), []);
  useEffect(() => void reload(), [reload]);
  const clear = async () => {
    if (!items || !confirm("Remove every entry from the export history? Files you already downloaded are not affected.")) return;
    await Promise.all(items.map((e) => db.deleteExport(e.id)));
    reload();
  };
  return (
    <Page title="Export History" subtitle="Files you exported from this browser. Stored copies can be downloaded again." actions={items?.length ? <Button variant="ghost" onClick={clear}>Clear history</Button> : undefined}>
      {!items ? (
        <div className="flex items-center gap-2 py-10 text-muted"><Spinner /> Loading</div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line py-12 text-center text-[13px] text-muted">Nothing exported yet. Exports from the photo editor, video editor and Product Studio show up here.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-panel-2 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-panel">
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {e.kind === "video" ? <Clapperboard size={14} className="text-muted" /> : e.kind === "product" ? <Package size={14} className="text-muted" /> : <ImageIcon size={14} className="text-muted" />}
                      <span className="font-medium">{e.filename}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{e.projectName}</td>
                  <td className="px-3 py-2 font-mono text-muted">{e.width}×{e.height} · {formatBytes(e.size)}</td>
                  <td className="px-3 py-2 text-muted">{timeAgo(e.createdAt)}</td>
                  <td className="px-3 py-1 text-right">
                    <IconButton label={e.blob ? `Download ${e.filename}` : "This file was too large to keep a copy"} disabled={!e.blob} onClick={() => e.blob && downloadBlob(e.blob, e.filename)}><Download size={14} /></IconButton>
                    <IconButton label="Remove from history" onClick={() => db.deleteExport(e.id).then(reload)}><Trash2 size={14} /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
