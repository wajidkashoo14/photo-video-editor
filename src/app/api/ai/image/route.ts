import { z } from "zod";
import { fail, guard, json, providerFor } from "@/lib/ai/server";

const Body = z.object({
  prompt: z.string().trim().min(3).max(2000),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024"),
});

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter a prompt between 3 and 2000 characters." }, 400);
  const provider = providerFor("text-to-image");
  if (!provider?.textToImage) return json({ error: "No image generation provider is configured on the server." }, 503);
  try {
    return json(await provider.textToImage(parsed.data));
  } catch (e) {
    return fail(e);
  }
}
