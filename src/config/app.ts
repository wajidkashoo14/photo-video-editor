/** Central, configurable product settings. Change the name here (or via env) to rebrand. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CreateStudio";
export const APP_TAGLINE = "Photo, video and product imagery in one studio";

/** Upload restrictions enforced on import (browser side) and again on any server route. */
export const LIMITS = {
  maxImageBytes: 80 * 1024 * 1024,
  maxVideoBytes: 4 * 1024 * 1024 * 1024,
  maxAudioBytes: 500 * 1024 * 1024,
  /** Longest edge used for interactive previews. Exports always use full resolution. */
  previewEdge: 2048,
  historyDepth: 60,
};

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"];
export const AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac", "audio/mp4", "audio/flac", "audio/webm", "audio/x-m4a"];

export type MediaKind = "image" | "video" | "audio";

/** Validates type and size. Returns the media kind or throws a user-readable error. */
export function classifyFile(file: File): MediaKind {
  const t = file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  let kind: MediaKind | null = null;
  if (IMAGE_TYPES.includes(t)) kind = "image";
  else if (VIDEO_TYPES.includes(t) || (!t && ["mp4", "mov", "webm", "mkv"].includes(ext))) kind = "video";
  else if (AUDIO_TYPES.includes(t) || (!t && ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext))) kind = "audio";
  if (!kind) throw new Error(`"${file.name}" is not a supported file type.`);
  const max = kind === "image" ? LIMITS.maxImageBytes : kind === "video" ? LIMITS.maxVideoBytes : LIMITS.maxAudioBytes;
  if (file.size > max) throw new Error(`"${file.name}" is larger than the ${Math.round(max / 1048576)} MB limit for ${kind} files.`);
  return kind;
}
