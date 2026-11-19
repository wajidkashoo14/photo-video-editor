import { DEFAULT_ADJ, NO_FILTER, type Adjustments, type FilterRef } from "@/lib/adjustments";
import { DEFAULT_TEXT, type TextStyle } from "@/lib/text";
import { uid } from "@/lib/utils";

export type TrackKind = "video" | "audio" | "text";
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
}

export const TRANSITIONS = ["none", "fade", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "wipe", "blur"] as const;
export type TransitionType = (typeof TRANSITIONS)[number];
export interface Transition { type: TransitionType; duration: number }
export const TRANSITION_LABELS: Record<TransitionType, string> = {
  none: "None", fade: "Fade", dissolve: "Cross dissolve", "slide-left": "Slide left", "slide-right": "Slide right",
  "slide-up": "Slide up", "slide-down": "Slide down", zoom: "Zoom", wipe: "Wipe", blur: "Blur",
};

export const TEXT_ANIMS = ["none", "fade", "slide-up", "pop", "typewriter"] as const;
export type TextAnim = (typeof TEXT_ANIMS)[number];

export type ClipType = "video" | "image" | "audio" | "text";

export interface Clip {
  id: string;
  trackId: string;
  type: ClipType;
  name: string;
  /** Timeline position and length, seconds. */
  start: number;
  duration: number;
  assetId?: string;
  /** In-point inside the source media, seconds. */
  offset: number;
  speed: number;
  volume: number; // 0..1
  fadeIn: number;
  fadeOut: number;
  /** Offset of the clip centre from the frame centre, project pixels. */
  x: number;
  y: number;
  /** 1 = fitted inside the frame (media) or natural size (text). */
  scale: number;
  rotation: number;
  opacity: number;
  crop: { l: number; t: number; r: number; b: number };
  flipX: boolean;
  adjustments: Adjustments;
  filter: FilterRef;
  lutId: string | null;
  lutMix: number;
  transIn: Transition;
  transOut: Transition;
  style?: TextStyle;
  anim: TextAnim;
}

export interface VideoProject {
  width: number;
  height: number;
  fps: number;
  /** Top of the list is the front-most track. */
  tracks: Track[];
  clips: Clip[];
  /** Set on blank projects nobody chose a size for: the first imported video then sets the frame size. */
  sizeFromMedia?: boolean;
}

export const makeTrack = (kind: TrackKind, n: number): Track => ({
  id: uid(), kind, name: `${kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text"} ${n}`, locked: false, hidden: false, muted: false,
});

export const emptyVideoProject = (width = 1920, height = 1080, fps = 30): VideoProject => ({
  width, height, fps,
  tracks: [makeTrack("text", 1), makeTrack("video", 2), makeTrack("video", 1), makeTrack("audio", 1)],
  clips: [],
});

export function makeClip(type: ClipType, trackId: string, start: number, duration: number, name: string, patch: Partial<Clip> = {}): Clip {
  return {
    id: uid(), trackId, type, name, start, duration, offset: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 }, flipX: false,
    adjustments: { ...DEFAULT_ADJ }, filter: { ...NO_FILTER }, lutId: null, lutMix: 1,
    transIn: { type: "none", duration: 0.5 }, transOut: { type: "none", duration: 0.5 },
    anim: "none",
    ...(type === "text" ? { style: { ...DEFAULT_TEXT } } : {}),
    ...patch,
  };
}

export const projectDuration = (p: VideoProject) => p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
export const clipEnd = (c: Clip) => c.start + c.duration;

/** Which track kind a clip type belongs on. */
export const trackKindFor = (t: ClipType): TrackKind => (t === "audio" ? "audio" : t === "text" ? "text" : "video");

/** Runtime description of an imported media file. */
export interface MediaAsset {
  id: string;
  name: string;
  kind: "video" | "image" | "audio";
  mime: string;
  size: number;
  url: string;
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  thumb?: string;
  /** Evenly spaced filmstrip frames for the timeline. */
  strip?: string[];
  /** Normalised audio peaks, `peaksPerSec` entries per second. */
  peaks?: number[];
  peaksPerSec?: number;
}
