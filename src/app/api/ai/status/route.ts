import { connection } from "next/server";
import { capabilityStatus, json } from "@/lib/ai/server";

/** Reports which cloud AI features are usable. Reads env at request time; never returns keys. */
export async function GET() {
  await connection();
  return json({ capabilities: capabilityStatus() });
}
