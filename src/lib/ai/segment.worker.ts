/**
 * Background removal runs here, in a dedicated worker. ONNX Runtime computes on whichever thread
 * calls it, so on the page it froze the whole tab while each image was analysed (about 20 s per
 * photo on a 4-core machine). Now only this worker waits.
 *
 * The page sends one job at a time (removeBackground in ./local.ts). It must start this as a classic
 * worker: Turbopack's worker runtime loads chunks with importScripts, which module workers lack.
 *
 * The model runs on the CPU (WebAssembly), the library's default. Its WebGPU path returned an empty
 * matte without any error on a GPU that lacks shader-f16; see DEVELOPMENT_PROGRESS.md before enabling it.
 */
import { removeBackground } from "@imgly/background-removal";

/** Where a job failed. "load" covers fetching the model and starting the engine. */
export type SegmentStage = "load" | "decode" | "inference" | "encode";
export interface SegmentJob {
  image: Blob;
}
export type SegmentReply =
  | { type: "progress"; key: string; current: number; total: number }
  | { type: "done"; bitmap: ImageBitmap }
  | { type: "error"; stage: SegmentStage; message: string };

// The project compiles against the DOM lib, so the worker's global scope is typed by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SegmentJob>) => void) | null;
  postMessage(message: SegmentReply, options?: { transfer?: Transferable[] }): void;
};

/** The library reports each step before starting it, so the last key names the step that failed. */
const STEP: Record<string, SegmentStage> = {
  "compute:decode": "decode",
  "compute:inference": "inference",
  "compute:mask": "encode",
  "compute:encode": "encode",
};

scope.onmessage = async ({ data: { image } }) => {
  let stage: SegmentStage = "load";
  try {
    const out = await removeBackground(image, {
      model: "isnet_fp16",
      // Raw pixels: callers read only the alpha, so a PNG encode here and a decode on the page buy nothing.
      output: { format: "image/x-rgba8" },
      progress: (key, current, total) => {
        stage = STEP[key] ?? stage;
        scope.postMessage({ type: "progress", key, current, total });
      },
    });
    // Raw output is typed "image/x-rgba8;width=W;height=H".
    const size = new URLSearchParams(out.type.split(";").slice(1).join("&"));
    const pixels = new Uint8ClampedArray(await out.arrayBuffer());
    const bitmap = await createImageBitmap(new ImageData(pixels, Number(size.get("width")), Number(size.get("height"))));
    scope.postMessage({ type: "done", bitmap }, { transfer: [bitmap] });
  } catch (e) {
    scope.postMessage({ type: "error", stage, message: e instanceof Error ? e.message : String(e) });
  }
};
