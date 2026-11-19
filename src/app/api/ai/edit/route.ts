import { fail, guard, json, providerFor } from "@/lib/ai/server";

const MAX_BYTES = 20 * 1024 * 1024;
const SIZES = ["1024x1024", "1536x1024", "1024x1536"];
const isPng = (f: unknown): f is File => f instanceof File && f.type === "image/png" && f.size > 0 && f.size <= MAX_BYTES;

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const form = await req.formData().catch(() => null);
  const prompt = String(form?.get("prompt") ?? "").trim();
  const size = String(form?.get("size") ?? "1024x1024");
  const image = form?.get("image");
  const mask = form?.get("mask");
  if (!form || prompt.length < 3 || prompt.length > 2000) return json({ error: "Enter a prompt between 3 and 2000 characters." }, 400);
  if (!SIZES.includes(size)) return json({ error: "Unsupported output size." }, 400);
  if (!isPng(image)) return json({ error: "Send the image as a PNG of at most 20 MB." }, 400);
  if (mask && !isPng(mask)) return json({ error: "The mask must be a PNG of at most 20 MB." }, 400);
  const provider = providerFor("image-edit");
  if (!provider?.imageEdit) return json({ error: "No image editing provider is configured on the server." }, 503);
  try {
    return json(await provider.imageEdit({ prompt, image, mask: isPng(mask) ? mask : null, size }));
  } catch (e) {
    return fail(e);
  }
}
