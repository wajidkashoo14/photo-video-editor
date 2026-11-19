import { useVideo } from "@/stores/videoStore";
import { mixAudio } from "./export";
import { makeClip, makeTrack, projectDuration, type Clip } from "./types";

export interface Cue { start: number; end: number; text: string }

const stamp = (s: string) => {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d{1,3})/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : NaN;
};

/** Parses SubRip (.srt) and WebVTT (.vtt) cue blocks. */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = stamp(a), end = stamp(b);
    const body = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Adds cues as styled text clips on a new, dedicated subtitle track (one undo step). */
export function addSubtitleTrack(cues: Cue[]): number {
  if (!cues.length) return 0;
  const s = useVideo.getState();
  const { width, height } = s.project;
  const k = Math.min(width, height) / 1080;
  const track = { ...makeTrack("text", 0), name: "Subtitles" };
  const clips: Clip[] = [];
  let last = 0;
  for (const c of cues) {
    const start = Math.max(c.start, last); // overlapping cues are trimmed so clips never collide
    if (c.end - start < 0.05) continue;
    last = c.end;
    clips.push(
      makeClip("text", track.id, start, c.end - start, c.text.split("\n")[0].slice(0, 24), {
        y: height * 0.38,
        style: {
          ...makeClip("text", "", 0, 0, "").style!,
          text: c.text, fontSize: Math.round(48 * k), fontWeight: 600, bg: "#000000", bgPadding: Math.round(14 * k), bgRadius: Math.round(8 * k),
        },
      }),
    );
  }
  s.setProject((p) => ({ ...p, tracks: [track, ...p.tracks], clips: [...p.clips, ...clips] }));
  return clips.length;
}

/** 16 kHz mono PCM WAV: small enough for speech APIs, ample for recognition. */
function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Mixes the timeline's audio, sends it to the server-side speech provider and returns cues. */
export async function transcribeTimeline(onStage: (s: string) => void): Promise<Cue[]> {
  const { project, assets } = useVideo.getState();
  const duration = projectDuration(project);
  onStage("Mixing audio");
  const mix = await mixAudio(project, assets, duration, () => {});
  if (!mix) throw new Error("The timeline has no audible audio to transcribe.");
  const rate = 16000;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * rate), rate);
  const node = ctx.createBufferSource();
  node.buffer = mix;
  node.connect(ctx.destination);
  node.start();
  const mono = await ctx.startRendering();
  const form = new FormData();
  form.set("audio", encodeWav(mono.getChannelData(0), rate), "audio.wav");
  onStage("Transcribing");
  const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { srt?: string; error?: string };
  if (!res.ok || !data.srt) throw new Error(data.error || "Transcription failed.");
  return parseSubtitles(data.srt);
}
