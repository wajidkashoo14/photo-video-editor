"use client";

import { create } from "zustand";
import { LIMITS } from "@/config/app";
import { db, type ProjectRecord } from "@/lib/db";
import { parseCube, type Lut3D } from "@/lib/gl/adjust";
import type { TextStyle } from "@/lib/text";
import { uid } from "@/lib/utils";
import { loadProjectMedia } from "@/lib/video/media";
import { clipEnd, emptyVideoProject, makeClip, makeTrack, projectDuration, trackKindFor, type Clip, type MediaAsset, type Track, type TrackKind, type VideoProject } from "@/lib/video/types";

interface VideoState {
  projectId: string | null;
  name: string;
  createdAt: number;
  project: VideoProject;
  assets: Record<string, MediaAsset>;
  luts: Map<string, Lut3D>;
  lutNames: Record<string, string>;
  selectedId: string | null;
  time: number;
  playing: boolean;
  pxPerSec: number;
  snapping: boolean;
  past: VideoProject[];
  future: VideoProject[];
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  /** Supplied by the preview so saves can include a poster frame. */
  thumbProvider: (() => string | undefined) | null;

  load: (p: ProjectRecord) => Promise<void>;
  set: (patch: Partial<VideoState>) => void;
  snapshot: () => void;
  setProject: (fn: (p: VideoProject) => VideoProject, history?: boolean) => void;
  updateClip: (id: string, patch: Partial<Clip>, history?: boolean) => void;
  addAssetClip: (asset: MediaAsset, at?: number, trackId?: string) => Clip | null;
  addTextClip: (patch?: Omit<Partial<Clip>, "style"> & { style?: Partial<TextStyle> }) => Clip;
  removeClip: (id: string) => void;
  duplicateClip: (id: string) => void;
  split: () => boolean;
  addTrack: (kind: TrackKind) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  addLut: (name: string, text: string) => Promise<string>;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
}

/** First position at or after `start` where a clip of `duration` fits on the track. */
export function freeStart(p: VideoProject, trackId: string, start: number, duration: number, ignoreId?: string): number {
  const others = p.clips.filter((c) => c.trackId === trackId && c.id !== ignoreId).sort((a, b) => a.start - b.start);
  let s = Math.max(0, start);
  for (const o of others) if (s < clipEnd(o) - 1e-6 && s + duration > o.start + 1e-6) s = clipEnd(o);
  return s;
}

export const useVideo = create<VideoState>((set, get) => ({
  projectId: null,
  name: "Untitled video",
  createdAt: 0,
  project: emptyVideoProject(),
  assets: {},
  luts: new Map(),
  lutNames: {},
  selectedId: null,
  time: 0,
  playing: false,
  pxPerSec: 80,
  snapping: true,
  past: [],
  future: [],
  dirty: false,
  saving: false,
  savedAt: null,
  thumbProvider: null,

  async load(p) {
    const project = (p.data as { project?: VideoProject })?.project ?? emptyVideoProject(p.width, p.height);
    const media = await loadProjectMedia(p.id);
    const luts = new Map<string, Lut3D>();
    const lutNames: Record<string, string> = {};
    for (const rec of await db.listAssets(p.id)) {
      if (rec.kind !== "lut") continue;
      try {
        luts.set(rec.id, parseCube(await rec.blob.text(), rec.id));
        lutNames[rec.id] = rec.name;
      } catch {
        /* a corrupt LUT is skipped; clips referencing it render ungraded */
      }
    }
    for (const a of Object.values(get().assets)) URL.revokeObjectURL(a.url);
    set({
      projectId: p.id, name: p.name, createdAt: p.createdAt, project, assets: Object.fromEntries(media.map((m) => [m.id, m])), luts, lutNames,
      selectedId: null, time: 0, playing: false, past: [], future: [], dirty: false, savedAt: p.updatedAt,
    });
  },

  set: (patch) => set(patch),

  snapshot() {
    const { past, project } = get();
    if (past[past.length - 1] === project) return;
    set({ past: [...past, project].slice(-LIMITS.historyDepth), future: [] });
  },

  setProject(fn, history = true) {
    if (history) get().snapshot();
    set({ project: fn(get().project), dirty: true });
  },

  updateClip(id, patch, history = true) {
    get().setProject((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), history);
  },

  addAssetClip(asset, at, trackId) {
    const { project, time } = get();
    const kind = trackKindFor(asset.kind);
    const candidates = trackId ? project.tracks.filter((t) => t.id === trackId) : [...project.tracks].reverse().filter((t) => t.kind === kind && !t.locked);
    const track = candidates.find((t) => t.kind === kind && !t.locked);
    if (!track) return null;
    const duration = asset.kind === "image" ? 5 : asset.duration;
    const start = freeStart(project, track.id, at ?? time, duration);
    const clip = makeClip(asset.kind, track.id, start, duration, asset.name, { assetId: asset.id });
    get().setProject((p) => ({ ...p, clips: [...p.clips, clip] }));
    set({ selectedId: clip.id });
    return clip;
  },

  addTextClip(patch = {}) {
    let { project } = get();
    let track = project.tracks.find((t) => t.kind === "text" && !t.locked);
    get().snapshot();
    if (!track) {
      track = makeTrack("text", project.tracks.filter((t) => t.kind === "text").length + 1);
      project = { ...project, tracks: [track, ...project.tracks] };
    }
    const base = makeClip("text", track.id, 0, 3, "Text");
    const merged = { ...base, ...patch, style: { ...base.style!, ...(patch.style ?? {}) } };
    const clip = { ...merged, name: merged.style.text.split("\n")[0].slice(0, 24) || "Text", start: freeStart(project, track.id, get().time, merged.duration) };
    set({ project: { ...project, clips: [...project.clips, clip] }, dirty: true, selectedId: clip.id });
    return clip;
  },

  removeClip(id) {
    get().setProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }));
    if (get().selectedId === id) set({ selectedId: null });
  },

  duplicateClip(id) {
    const { project } = get();
    const c = project.clips.find((x) => x.id === id);
    if (!c) return;
    const copy = { ...structuredClone(c), id: uid(), start: freeStart(project, c.trackId, clipEnd(c), c.duration) };
    get().setProject((p) => ({ ...p, clips: [...p.clips, copy] }));
    set({ selectedId: copy.id });
  },

  split() {
    const { project, time, selectedId } = get();
    const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
    const minLen = 1 / project.fps;
    const inside = (c: Clip) => time > c.start + minLen && time < clipEnd(c) - minLen && !locked.has(c.trackId);
    const sel = project.clips.find((c) => c.id === selectedId);
    const targets = sel && inside(sel) ? [sel] : project.clips.filter(inside);
    if (!targets.length) return false;
    get().setProject((p) => ({
      ...p,
      clips: p.clips.flatMap((c) => {
        if (!targets.includes(c)) return [c];
        const head = time - c.start;
        const left: Clip = { ...c, duration: head, transOut: { ...c.transOut, type: "none" }, fadeOut: 0 };
        const right: Clip = { ...structuredClone(c), id: uid(), start: time, duration: c.duration - head, offset: c.offset + head * c.speed, transIn: { ...c.transIn, type: "none" }, fadeIn: 0, anim: "none" };
        return [left, right];
      }),
    }));
    return true;
  },

  addTrack(kind) {
    get().setProject((p) => {
      const t = makeTrack(kind, p.tracks.filter((x) => x.kind === kind).length + 1);
      // Audio tracks live at the bottom; visual tracks are added on top.
      return { ...p, tracks: kind === "audio" ? [...p.tracks, t] : [t, ...p.tracks] };
    });
  },

  updateTrack(id, patch) {
    get().setProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },

  removeTrack(id) {
    get().setProject((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id), clips: p.clips.filter((c) => c.trackId !== id) }));
  },

  async addLut(name, text) {
    const { projectId } = get();
    const id = uid();
    const lut = parseCube(text, id); // throws on invalid files before anything is stored
    if (projectId) await db.putAsset({ id, projectId, name, mime: "text/plain", kind: "lut", blob: new Blob([text], { type: "text/plain" }) });
    const luts = new Map(get().luts);
    luts.set(id, lut);
    set({ luts, lutNames: { ...get().lutNames, [id]: name } });
    return id;
  },

  undo() {
    const { past, future, project } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },

  redo() {
    const { past, future, project } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true });
  },

  async save() {
    const s = get();
    if (!s.projectId || s.saving) return;
    set({ saving: true });
    try {
      const project = s.project;
      const now = Date.now();
      const thumbnail = s.thumbProvider?.() ?? Object.values(s.assets).find((a) => a.thumb)?.thumb;
      await db.putProject({ id: s.projectId, name: s.name, kind: "video", createdAt: s.createdAt || now, updatedAt: now, width: project.width, height: project.height, thumbnail, data: { project } });
      set({ saving: false, savedAt: now, dirty: get().project !== project });
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },
}));

export const useDuration = () => useVideo((s) => projectDuration(s.project));
