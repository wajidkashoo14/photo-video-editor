"use client";

import { ArrowLeft, Check, Download, Redo2, Save, Undo2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, IconButton, Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export function EditorTopBar(p: {
  name: string;
  onRename: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  onSave: () => void;
  onExport: () => void;
  /** Editor-specific controls shown in the middle (zoom, preview, ...). */
  children?: ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <Link href="/projects" title="Back to projects" aria-label="Back to projects" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg">
        <ArrowLeft size={16} />
      </Link>
      <input
        aria-label="Project name"
        className="h-7 w-48 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium outline-none hover:border-line focus:border-accent focus:bg-panel-2"
        value={p.name}
        onChange={(e) => p.onRename(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
        <Redo2 size={16} />
      </IconButton>
      <div className="flex flex-1 items-center justify-center gap-1">{p.children}</div>
      <span className="mr-1 flex items-center gap-1.5 text-[11px] text-muted" aria-live="polite">
        {p.saving ? (
          <>
            <Spinner size={12} /> Saving
          </>
        ) : p.dirty ? (
          "Unsaved changes"
        ) : p.savedAt ? (
          <>
            <Check size={12} className="text-success" /> Saved {timeAgo(p.savedAt)}
          </>
        ) : null}
      </span>
      <Button size="sm" onClick={p.onSave} disabled={p.saving} title="Save (Ctrl+S)">
        <Save size={14} /> Save
      </Button>
      <Button size="sm" variant="primary" onClick={p.onExport}>
        <Download size={14} /> Export
      </Button>
    </header>
  );
}
