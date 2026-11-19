# CreateStudio: development progress

Last updated: 18 November 2026

## Where things stand

The local-first product is built and has been checked in a real browser:
- the Photo Editor, Video Editor, Compress Video and Product Studio;
- AI Tools, Templates, Brand Kit, Projects, Export History and Settings.

Everything runs in the browser. Projects and media are stored in IndexedDB. Video is encoded with WebCodecs. Background removal runs on-device. The server has one job: it holds the optional cloud AI key behind four API routes.

Accounts, a server database and cloud sync are **not built yet**. The target schema is ready in [`docs/schema.sql`](docs/schema.sql).

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | passes; 12 static routes, 4 dynamic API routes |
| Automated test suite | none yet; see [Testing](README.md#testing) |

The name "CreateStudio" comes from `NEXT_PUBLIC_APP_NAME` (default in `src/config/app.ts`), so the product can be renamed without code changes.

---

## Completed features

✅ means checked in the browser with scripted assertions on real output (pixels, file sizes, decoded media, IndexedDB records), not only by looking. ☑️ means built and type-checked, but not yet exercised end to end.

### Projects and storage
- ✅ Create projects:
  - from **New photo** or **New video**;
  - from 14 social-media size presets;
  - from templates;
  - from an AI result or a Product Studio cut-out.
- ✅ Rename and duplicate (the copy gets its own copies of every asset, with ids remapped in the edit data).
- ✅ Trash, restore, and permanent delete (also deletes the project's media).
- ✅ Autosave after 1.5 s of inactivity, Ctrl+S, and a "Saved just now" status. A WebP thumbnail is saved with each project.
- ✅ Non-destructive by design: originals are stored once in `assets`; projects store edit instructions only.
- ✅ Undo and redo, 60 steps, in both editors.
- ☑️ Storage usage, a request for persistent storage, theme (dark or light), and AI provider status on the Settings page.

### Photo Editor (`/photo`)
- ✅ Layers:
  - image, text, shape (rectangle, ellipse, triangle, star, line) and paint layers;
  - per-layer visibility, lock, opacity, 16 blend modes and drop shadow;
  - reorder, duplicate and delete.
- ✅ Transform: move with centre snapping (Shift locks an axis), 8 scale handles, rotate handle (Shift snaps to 15°), and arrow-key nudge.
- ✅ Canvas: crop with aspect presets, straighten, rotate 90° either way, flip, resize (with or without scaling the content), zoom, pan and fit.
- ☑️ Brush, eraser and clone stamp:
  - the eraser paints into a layer **mask**, so nothing is deleted;
  - for the clone stamp, Alt-click sets the source.
- ✅ 22 adjustments, run on the GPU in a single WebGL2 shader pass:
  - tone: exposure, brightness, contrast, highlights, shadows, whites, blacks, gamma;
  - colour: temperature, tint, saturation, vibrance;
  - detail and effects: clarity, sharpness, dehaze, vignette, grain;
  - grading: lift, gain, and red, green and blue balance.
- ✅ Before/after compare (`\`), and saved adjustment presets.
- ✅ 36 looks in 12 categories, each with an intensity control and live thumbnails:
  - Cinematic, Vintage, Film, Portrait, Landscape, Black & White;
  - Warm, Cool, Moody, Luxury, Editorial, Social Media.
- ✅ Export:
  - PNG, JPEG or WebP, with quality and scale;
  - JPEG flattens transparency onto white;
  - every export is recorded in Export History.
- ✅ The **Brand logo** button places the Brand Kit logo as a new layer.
- ✅ The AI tab (all on-device):
  - remove background, written as a mask so it stays editable;
  - auto colour (histogram levels, white balance, gamma);
  - smart crop (saliency-based, for any aspect).
- Keyboard: V H C T U B E S (tools), `[` `]` (brush size), Enter (apply crop), Esc, Delete, arrows, Ctrl+Z/Shift+Z/Y/S/D/0/=/-.

### Video Editor (`/video`)
- ✅ Multitrack timeline:
  - video, audio and text tracks, with lock, hide, mute and delete;
  - move clips (including across tracks), trim both ends, snapping, and a virtualised ruler;
  - waveforms and filmstrips;
  - split at the playhead: the selected clip, or every clip under the playhead.
- ✅ Import MP4, WebM and MOV (where the browser can decode it), audio, and images. A blank project takes its frame size from the first video imported; a project created at a preset size keeps that size.
- ✅ Text:
  - presets: Title, Subtitle, Lower third, Typewriter, Outline pop;
  - full text styling, shared with the Photo Editor;
  - animations: fade, slide-up, pop, typewriter.
- ✅ Subtitles: import `.srt` or `.vtt` onto a new "Subtitles" track. Tags are stripped and each cue becomes an editable text clip.
- ☑️ Auto subtitles: the timeline audio is mixed, encoded to 16 kHz WAV and transcribed by the server provider. The button is disabled until a key is configured.
- ☑️ Clip controls:
  - transform (position, scale, rotation, opacity, crop, horizontal flip) and speed;
  - volume, with fade in and out;
  - transitions in and out: fade, dissolve, four slides, zoom, wipe, blur;
  - freeze frame.
- ☑️ Colour: the same 22 adjustments and 36 looks as photos, plus `.cube` 3D LUT import with a mix control.
- ✅ Export:
  - MP4 (H.264 + AAC) or WebM (VP9 + Opus);
  - 720p, 1080p, 1440p or 4K, at 24 to 60 fps;
  - quality presets or a custom bitrate;
  - real progress, measured as frames encoded out of total, with cancel;
  - only sizes the device can actually encode are offered;
  - it keeps running while you use other pages (browser Back included). If it ends there, a toast reports the file or the error. If Next drops the editor (the third other page opened), it stops and a toast says so;
  - closing or reloading the tab while it runs makes the browser ask first ("Leave site?").
- Verified outputs:
  - in headless Edge 157, leaving during an export brought up the browser's leave prompt, and "stay" kept the export running; after a cancel, leaving did not ask. (The in-app browser pane used during development never shows leave prompts, so check this in a real browser.)
  - a 120 s 1080p export finished while Home was open: 3,600 frames, the download, and the toast; going Forward showed the result in the dialog. With three other pages opened, it stopped at frame 151 with a toast and no download;
  - 1280×720 MP4 with AVC video and stereo AAC;
  - 1280×720 WebM with VP9 and Opus: 4.02 s, 120 frames encoded in 2.6 s, with source footage present on both sides of a split and the title alone after the footage ends.

### Compress Video (`/compress`)
Shrinks existing videos on the device without changing what they look like, and proves it before you download.
- ✅ Batch queue: add many videos; they are read and compressed one at a time, in list order. Each row has progress, cancel, retry with the current settings, and remove.
- ✅ Goals:
  - **Visually lossless** (default), **Balanced** and **Smallest** use constant-quality (quantizer) encoding. H.264 and HEVC use QP 20, 24 and 29; AV1 and VP9 use 99, 118 and 144 of 255 (VP9 before Chromium 145 uses its older 0–63 scale: 25, 30 and 36). Encoders without quantizer support fall back to Mediabunny's bitrate estimate for the same level; the SSIM check still reports the real result.
  - **Target size** uses a bitrate budget. If the first pass overshoots, a second pass corrects it. When the budget is too tight for the original frame size, it picks a lower standard resolution.
- ✅ Resolution and frame rate are kept by default. An optional maximum (4K to 480p) never upscales.
- ✅ Formats: H.264, HEVC and AV1 in MP4, and VP9 in WebM. The list shows only what this browser can encode.
- ✅ Audio:
  - compressed audio (AAC, Opus, MP3, Vorbis, AC-3, E-AC-3) is copied untouched when the container accepts it;
  - otherwise it is re-encoded at 160 to 192 kbps (AAC or Opus for MP4, Opus or Vorbis for WebM);
  - it can be removed.
- ✅ Never a bigger file. A result that isn't at least 3% smaller is discarded and the original is kept, with a tip for what to try instead. "Already under the target" and "target too small" are explained before any encoding.
- ✅ Quality check: SSIM on luma over 6 frames spread across the video, compared at the output resolution on a centre region of up to 1920×1080 with no downscaling. The result is shown as a plain verdict, the mean, and the worst frame.
- ✅ **Compare**: a before/after wipe at any moment, with Fit and 100% (real pixels).
- ✅ Download, **Download all**, and an Export History entry for each saved result.
- ✅ HDR sources get a warning that the result may not keep HDR.
- ✅ The batch keeps running while you use other pages, because Next keeps the route alive but hidden. Next keeps up to 3 routes, so the batch stops when a third other page is opened and this route is evicted, and a toast says how many videos were left unfinished. Closing or reloading the tab would also stop it, so while a batch runs the browser asks first.
- Verified outputs, on clips recorded in the browser with `MediaRecorder`:
  - **Visually lossless**, 2.1 MB 720p H.264 source: H.264 1.4 MB (−33%, SSIM 0.991, audio copied), HEVC 1.2 MB (−44%, SSIM 0.990), AV1 753 KB (−65%, SSIM 0.986), VP9 WebM 846 KB (−61%, SSIM 0.985, audio re-encoded to Opus);
  - **Target size 2 MB**, 8.3 MB noisy source: 1,835,528 bytes in one pass, honestly reported as "Visible quality loss" (SSIM 0.817);
  - noisy 11.4 Mbps source at **Visually lossless**: the result would have been 11.6 MB, so the original was kept and the tip suggested HEVC or AV1, or Balanced;
  - cancel, retry, remove while reading, list order, and **Download all**;
  - work continued on another page; it stopped within 4 frames once the route was dropped;
  - production build (`next start`): opening the Video Editor and then Compress Video logs nothing in the console, and a 3.4 MB 720p clip became 1.2 MB (−64%, SSIM 0.994, audio copied).

### AI
- ✅ Adapter architecture (`src/lib/ai/server.ts`):
  - the `AIProvider` interface has one OpenAI implementation (text to image, image edit, transcription);
  - choose a provider with `AI_PROVIDER`;
  - keys are read from the server environment only, and never sent to the browser.
- ✅ No fake results. `/api/ai/status` reports which capabilities are available. Cloud features show a "needs a key" notice with setup steps, and their controls stay disabled until a key is set.
- ✅ Route guards, verified with curl:
  - cross-origin POST is rejected with 403;
  - invalid input gets 400 (zod validation, plus type and size limits);
  - no provider configured gives 503;
  - more than `AI_RATE_LIMIT_PER_MIN` requests per client per minute gives 429, including when the client forges `X-Forwarded-For`.
- ✅ On-device background removal: ISNet fp16 through `@imgly/background-removal`, with real download and inference progress.
  - It runs in a Web Worker (`src/lib/ai/segment.worker.ts`), so the page stays usable while an image is analysed: it still scrolls, takes clicks and changes pages.
  - Product Studio, the Photo Editor and AI Tools share one worker per tab. It keeps the engine loaded for the tab's life and takes one image at a time.
  - A failed start or run gets a fresh worker for the next image. An unreadable image does not restart the engine.
  - Verified on the production build, on a 4-core machine using the CPU:
    - while images were analysed, the page's longest stall was 80 to 230 ms, against one 20.5 s freeze per photo before;
    - switching to another page mid-analysis took 0.46 s;
    - analysis took 22 to 24 s per 1600 px photo, the same as before within this machine's noise;
    - Product Studio, the Photo Editor's AI tab and AI Tools all produced their results, and the dev server loads the worker too.
- ☑️ Cloud text to image and generative edit: the code paths are complete, but they have not been run against the live API because no key was available.

### Product Studio (`/product`)
- ✅ Batch queue:
  - add many photos; they are processed one at a time, because the model is memory hungry;
  - per-item progress, retry and remove.
- ✅ The cut-out changes **only the alpha channel**, so the product's pixels (shape, artwork, colours) are copied through untouched.
- ✅ A despeckle pass removes islands of background texture the model half kept, so a white backdrop stays clean and the trim box hugs the product.
- ✅ Marketplace presets:

  | Preset | Size | Backdrop | Product fill | Format |
  | --- | --- | --- | --- | --- |
  | Amazon | 2000×2000 | white | 85% | JPEG |
  | Etsy | 2700×2025 | off-white | 78% | |
  | Shopify | 2048×2048 | | 80% | |
  | Instagram | 1080×1350 | | 72% | |
  | Website | 1600×1600 | transparent | 86% | WebP |

- ✅ Seven studio backdrops or a custom colour. Contact shadow, drop shadow or none, with a strength control. Product size and vertical offset.
- ✅ An optional "balance exposure" setting adjusts the brightness range only, so hue and saturation stay true.
- ✅ **Download all**, or **Save all to folder** where the File System Access API is available. A transparent backdrop is written as PNG even when the preset is JPEG.
- ✅ The batch keeps running while you use other pages. Next keeps up to 3 routes, so opening a third other page drops this one: the queue then stops before the next photo, and a toast says how many were left unfinished. While cut-outs run, and while **Download all** or **Save all to folder** writes files, closing or reloading the tab makes the browser ask first.
- Verified outputs:
  - two products exported as 2000×2000 JPEGs;
  - pure-white corners, and zero stray pixels on the backdrop;
  - product colours match the source within JPEG noise: red (214,42,42) against #d62828, blue (30,80,215) against #1d4ed8;
  - each product fills the 85% box;
  - production build: the leave warning was on while cut-outs ran and during **Download all**, and off once each had finished;
  - with 8 photos queued and three other pages opened, cut-outs carried on while the other pages were showing, then stopped with "6 photos unfinished" and the leave warning was released;
  - re-checked on the production build after background removal moved into a worker: the same 2000×2000 size and product colours, white corners and zero stray pixels. An unreadable file in the batch showed "The source image could not be decoded." and the next photos went ahead without restarting the engine.

### Templates, Brand Kit, Export History
- ✅ 7 templates that adapt to any canvas size and take the brand palette: product ad, business promo, travel, portfolio, event, announcement, showcase. All layers stay editable.
- ✅ Brand Kit:
  - colours: the first four fill the template roles, and all appear as swatches in every colour picker;
  - logo: raster formats only, so it can be placed in the editor;
  - fonts: TTF, OTF and WOFF, validated with `FontFace` before saving, and shown in every font list.
- ✅ Export History: lists every export from this browser, can download it again (files up to 512 MB are kept), remove entries, and clear the list.

### Security (current build)
- Keys stay on the server (`server-only` module). `.env*` files are git-ignored, except `.env.example`.
- File type and size checks run on every import, in the browser, and again in the API routes:

  | File | Limit |
  | --- | --- |
  | Images | 80 MB |
  | Video | 4 GB |
  | Audio | 500 MB |
  | Fonts and logo | 10 MB |
  | Subtitles | 5 MB |
  | AI image upload | 20 MB |
  | AI audio upload | 25 MB |

- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a restrictive `Permissions-Policy`. `X-Powered-By` is removed.
- AI routes add a same-origin check, a rate limit, zod validation and `Cache-Control: no-store`.

---

## Not built yet, or only partly built

These are listed honestly. None of them is shown in the UI as working.

| Area | Status | Limitation and best feasible path |
| --- | --- | --- |
| **Accounts, authentication, access control** | Not built | Needs the server database. Schema is in `docs/schema.sql` (users, sessions as hashed tokens, OAuth). Suggested path: Auth.js or a small session layer on Postgres. Protect `/api/ai/*` first. |
| **Cloud storage and sync** | Not built | Local-first stays primary. Next: S3-compatible private bucket with presigned PUT and GET, and per-project `revision` for conflict detection (in the schema). |
| Server database, migrations | Not built | No Postgres in the development environment. `docs/schema.sql` is ready to apply. Prisma or Drizzle can be generated from it. |
| Shared rate limiting | Partial | The in-memory limiter works per server instance and resets on restart. Multi-instance deployments need Redis (for example Upstash) or the `ai_requests` table. |
| Perspective correction | Not built | Feasible: a 4-corner homography warp in the existing WebGL renderer. |
| Selection tools (marquee, lasso, magic wand), colour replacement | Not built | Masks already exist (eraser masks, AI subject masks). Next: turn selections into mask bitmaps; colour replacement as an HSL-range adjustment in the shader. |
| Object removal and content-aware heal | Partial | The manual clone stamp works. Cloud generative edit works on the whole image from a prompt. The `/api/ai/edit` route already accepts a mask, but the UI to paint one is missing. |
| AI upscaling, denoise, face enhance, restoration, generative expand | Not built | Add a method to `AIProvider` and a route. On-device ONNX models are possible but large (10 to 70 MB). |
| Video reverse playback | Not built | Feasible at export (decode, then write frames in reverse). Preview needs a frame cache. |
| Video stabilisation | Not built | Needs motion estimation, for example OpenCV.js (about 8 MB wasm), or server-side ffmpeg `vidstab`. |
| Keyframed clip animation, image-sequence import | Not built | Text animations and transitions exist. Keyframes would add time-varying values to the `Clip` model. |
| AI video summarisation, highlight detection, AI suggestions | Not built | Needs a multimodal provider. The adapter interface is where it plugs in. |
| Cloud AI against the live API | Not tested | No key was available. Validation, no-key, 403 and 429 paths are tested. |
| Heavy work in Web Workers | Partial | Background removal runs in a worker. Video export still runs on the main thread with async yields; moving `exportVideo` into a worker with OffscreenCanvas is the next performance step. |
| Automated tests | Not built | Testing so far is scripted browser checks (see README). Next: Playwright end-to-end tests for the flows above. |

---

## Architecture

```
Browser (Next.js 16 App Router, React 19, client components)
 ├─ UI           AppShell, ui.tsx kit, pages under src/app/*
 ├─ State        Zustand: usePhoto, useVideo (snapshot undo/redo)
 ├─ Engines
 │   ├─ photo    Canvas 2D layer compositor + WebGL2 colour pipeline (adjustments, looks, 3D LUTs)
 │   ├─ video    Player (one media element per clip, shared clock) for preview;
 │   │           Mediabunny + WebCodecs for frame-accurate export; OfflineAudioContext mix
 │   ├─ compress probe → plan (goal, codec, audio copy or encode) → Mediabunny conversion
 │   │           → SSIM check against the original; never keeps a bigger file
 │   └─ product  ONNX segmentation (on-device, in a Web Worker) → alpha-only cut-out → despeckle → compose
 ├─ Storage      IndexedDB "createstudio" v1: projects | assets | exports | kv
 └─ fetch /api/ai/* ─────────────┐
                                 ▼
Server (Node runtime, route handlers)
 └─ src/lib/ai/server.ts  guard (same-origin, rate limit) → zod validation → AIProvider → OpenAI
                          keys only from process.env, never serialised to the client
```

Key decisions:

- **Mediabunny with WebCodecs, not FFmpeg.wasm.**
  - Hardware encoding.
  - Streams from the Blob, with no 2 GB wasm memory ceiling.
  - Small bundle.
  - Export uses the same `drawFrame` as preview, so what you see is what you get.
- **A custom canvas engine, not Fabric or Konva.** The layer model maps directly onto masks, the WebGL colour pipeline and export at full resolution, with no second scene graph.
- **Local-first IndexedDB.**
  - Works with no backend and no account.
  - Media never leaves the device unless a cloud AI feature is used.
  - Records already mirror the planned server schema.
- **On-device AI where feasible** (segmentation, auto colour, smart crop). Cloud AI goes only through the server adapter.
- **Preview at 2048 px, export at full resolution.** Interactive editing stays fast on large photos.

## Files

```
src/
  app/
    layout.tsx, page.tsx (Home), globals.css
    photo/ video/                    editor routes (server pages wrapping client editors)
    compress/ product/ ai/ templates/ brand/ exports/ projects/ settings/   pages + title layouts
    api/ai/{status,image,edit,transcribe}/route.ts                server AI endpoints
  components/
    AppShell.tsx  EditorTopBar.tsx  ProjectGrid.tsx  TextStyleEditor.tsx  ui.tsx
    photo/  PhotoEditor.tsx  PhotoCanvas.tsx  Panels.tsx
    video/  VideoEditor.tsx  Timeline.tsx  Inspector.tsx  FrameCompare.tsx (before/after wipe)
  config/app.ts                      name, upload limits, accepted types
  lib/
    db.ts  projects.ts  assets.ts  utils.ts  hooks.ts  brand.ts  presets.ts  templates.ts  text.ts
    adjustments.ts  gl/adjust.ts     colour model + WebGL2 renderer + .cube parser
    photo/  types.ts render.ts actions.ts create.ts
    video/  types.ts engine.ts player.ts media.ts export.ts subtitles.ts compress.ts
    ai/     server.ts (server-only adapter + guards)  local.ts (on-device AI)
            segment.worker.ts (background removal, off the main thread)
    product.ts                       cut-out, despeckle, composition
  stores/  photoStore.ts  videoStore.ts
docs/schema.sql                      planned PostgreSQL schema
.env.example                         every supported environment variable
```

About 8,800 lines of TypeScript and CSS.

## Bugs found during development

All fixed and re-verified unless marked open.

| Bug | Cause | Fix |
| --- | --- | --- |
| Blank photo canvas in development | React StrictMode remount left the requestAnimationFrame id set | Reset it in effect cleanup |
| Images drawn upside down | `UNPACK_FLIP_Y_WEBGL` is ignored for `ImageBitmap` | Flip the texture coordinate in the vertex shader |
| Clone stamp sampled the mirrored spot | Offset sign reversed | Draw with `+offset` |
| Video filmstrip import threw | Mediabunny needs `fit` when width and height are both given | Pass width only |
| Hydration mismatch on Product Studio and Settings | Browser-only checks ran during the server render | `useClientValue` (`useSyncExternalStore` with a server snapshot) |
| 11 React hooks lint errors | setState in effects, components created during render, ref reads in render | Derived state during render, module-level components, refs only in handlers |
| Product cut-outs kept specks of background | Segmentation half-keeps fine texture near the subject | `despeckle()`: drop regions smaller than 0.5% of the main one, or under 25% opacity |
| Two "Untitled" projects per visit to `/photo` or `/video` (development) | The effect ran twice under StrictMode and each run created a project | `createBlankProject` shares a single pending creation |
| Brand Kit logo could not be used anywhere (the page said to drag it, which cannot work across pages) | Missing feature | **Brand logo** button in the Photo Editor. The logo upload accepts only formats the editor can decode. |
| Importing a video changed a preset-sized project (for example Reel 1080×1920 became 1920×1080) | First-video sizing ignored the user's choice | `sizeFromMedia` flag, set only on blank projects and cleared by manual size changes |
| AI rate limit could be bypassed | The limiter keyed on the first `X-Forwarded-For` hop, which the client controls | Key on `X-Real-IP`, else the last hop |
| Client pages had no page title | Client components cannot export metadata | Route `layout.tsx` files with metadata |
| Compress progress jumped to 100% at once and sat there while encoding ran | Chrome's `MediaRecorder` MP4s declare a track duration of about 0.1 s, and the conversion measures progress against it | A clearly short declared duration is replaced with the track's measured length |
| Two Compress settings changed before a re-render kept only the second | `set()` merged into the settings captured at render | Merge into the settings ref |
| Compress page scrolled sideways at 1280 px | The grid's `1fr` column could not shrink below the one-line file details | `minmax(0,1fr)` and `min-w-0` |
| After visiting another page, a Compress batch showed "Waiting" forever | Next 16 keeps routes alive but hidden (React Activity) and runs effect cleanups on hide; the cleanup aborted the work | Keep working while hidden; stop only when the route's DOM leaves the document |
| Compress batch ran in whatever order files finished reading | Files were read in parallel | Read them one after another |
| A video removed while it was being read was still compressed | The read finished and queued it anyway | Skip removed items |
| Production builds ran Mediabunny twice ("Mediabunny was loaded twice" in the browser console and the build log), so its muxers used a second copy of the library's classes | Turbopack's scope hoisting merged most of Mediabunny into one module but left `output-format.js` outside it. The two import each other, so the runtime started the merged module again from inside its own first run | `experimental.turbopackScopeHoisting: false` in `next.config.ts`. Production only (dev never hoists); client JS grows 2.7%. A first attempt, `serverExternalPackages`, silenced only the build log and sent an open dev tab into a reload loop after the config restart, so it was reverted |
| Leaving the Video Editor mid-export (browser Back) cancelled the export without a word | Next runs effect cleanups when it hides a route, and the export dialog aborted in one | The export now carries on while the route is hidden and stops only if the route is dropped, with a toast either way when it ends off-screen. `usePageActivity` in `lib/hooks.ts` is shared with Compress Video |
| The quality check made Chrome warn about slow canvas readbacks | It read pixels from the decoder's GPU canvas for every sampled frame | Copy each region into a CPU-side canvas (`willReadFrequently`) and read that |
| The whole tab froze for about 20 s per image during background removal (Product Studio, Photo Editor, AI Tools) | ONNX Runtime computes on the thread that calls it, and `@imgly/background-removal` was called on the page's main thread | The library runs in a dedicated worker (`segment.worker.ts`), started as a classic worker because Turbopack's worker runtime loads chunks with `importScripts` |
| The model was described as "about 40 MB" in the UI and the docs | It is 84 MB, plus an 11 MB engine | Corrected to about 95 MB everywhere |

### Open issues
- Destructive confirmations (permanent delete, removing used media) use the native `confirm()` dialog. It works, but it doesn't match the app's modal styling.
- The cloud AI routes have **no authentication**. Anyone who can reach a server with a key configured can spend the key's quota, up to the per-IP rate limit. Do not expose such a deployment publicly until accounts exist; put it behind access control instead.
- Background removal:
  - runs on the CPU. The library's WebGPU path was tried and left off. On the development machine's Intel Gen9 GPU, which lacks `shader-f16`, ONNX Runtime 1.21 returned an all-transparent matte for the fp16 model with no error, so every photo came back as "No product could be found". A WebGPU path needs a `shader-f16` check (or the fp32 model), a sanity check on the matte with a CPU fallback, and testing on a GPU that has the feature;
  - runs single-threaded, because the page is not cross-origin isolated (no COOP/COEP headers), which makes it about 2 to 4 times slower;
  - downloads about 95 MB from IMG.LY's CDN the first time it runs in a tab: the 84 MB model and an 11 MB engine. The CDN allows caching for 4 hours. Even so, in the development browser every new worker spent 17 to 20 s fetching the model again, minutes after the previous fetch. Next step: keep the files in Cache Storage so later visits start quickly;
  - Product Studio's work after each cut-out still runs on the page: drawing, despeckle, trim and previews. That is 0.2 to 0.5 s per photo. It could move into the worker with OffscreenCanvas;
  - **`@imgly/background-removal` is AGPL-3.0.** A closed-source deployment needs IMG.LY's commercial licence or a permissively licensed model.
- No Content-Security-Policy yet. It needs `wasm-unsafe-eval`, `blob:` and the model CDN allow-listed, `worker-src 'self'` for the background removal worker, and nonces for Next's inline scripts.
- Export History keeps files up to 512 MB. Larger exports are listed but cannot be downloaded again.
- Very large photos (above about 50 MP) can exceed the browser's canvas memory when exported at full size.
- Editors are designed for desktop, and the light theme has not been reviewed page by page.
- Compress Video:
  - the quality levels were tuned on synthetic clips recorded in the browser. They still need checking against real phone and camera footage, including portrait clips with rotation metadata;
  - savings come mostly from high-bitrate phone and camera files. Files that are already efficiently compressed (most downloads) usually get "No saving", by design;
  - browser encoders are less efficient than x264 or x265 at slow presets, and speed depends on hardware: about 0.7× to 1.5× real time at 720p here;
  - each result is held in memory until downloaded, so results over about 2 GB may fail. Next step: stream to disk with the File System Access API;
  - HDR is not guaranteed to survive re-encoding (the page warns).
- Turbopack scope hoisting is off for production builds (see the Mediabunny row above). Turn it back on once a Next upgrade handles import cycles that cross a merged module. To check: build, start, open the Video Editor and then Compress Video, and look for "Mediabunny was loaded twice" in the console.

---

## Next implementation tasks (in order)

1. **Playwright tests** for the verified flows (create, edit, export photo; import, split, export video; Compress Video goals and "never bigger"; Product Studio batch; project trash and restore; API guards).
2. **Accounts**: apply `docs/schema.sql`, add sessions, and require a signed-in user on `/api/ai/*`. Log each call in `ai_requests` and enforce per-user quotas.
3. **Cloud sync**: presigned uploads to a private bucket; sync projects and assets by `revision`.
4. **Mask painting for generative edit** (object removal), using the mask parameter `/api/ai/edit` already accepts.
5. **Selections and colour replacement** in the Photo Editor; **perspective** in the WebGL renderer.
6. **Move video export into a Web Worker**, and add COOP/COEP (`credentialless`) for multi-threaded ONNX.
7. Replace `confirm()` with the app's `Modal`. Add a CSP.
8. Video: reverse, keyframes, image sequences. Then stabilisation.
9. Compress Video: calibrate the quality levels on real phone footage, and stream large results to disk.

## Commands to continue

```bash
npm install                 # Node 20.9+ (developed on Node 24)
cp .env.example .env.local  # optional: add OPENAI_API_KEY for cloud AI
npm run dev                 # http://localhost:3000
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
npm run build && npm start  # production build and server
psql "$DATABASE_URL" -f docs/schema.sql   # only when starting the accounts phase
```
