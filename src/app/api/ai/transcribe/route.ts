import { fail, guard, providerFor, json } from "@/lib/ai/server";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  const language = String(form?.get("language") ?? "").trim();
  if (!(audio instanceof File) || !audio.size) return json({ error: "No audio was sent." }, 400);
  if (audio.size > MAX_BYTES) return json({ error: "The audio is longer than the provider accepts (about 13 minutes). Shorten the timeline and try again." }, 413);
  if (!["audio/wav", "audio/x-wav"].includes(audio.type)) return json({ error: "Audio must be sent as WAV." }, 400);
  if (language && !/^[a-z]{2}$/.test(language)) return json({ error: "Language must be a two-letter code." }, 400);
  const provider = providerFor("transcribe");
  if (!provider?.transcribe) return json({ error: "No speech-to-text provider is configured on the server." }, 503);
  try {
    return json({ srt: await provider.transcribe({ audio, language: language || undefined }) });
  } catch (e) {
    return fail(e);
  }
}
