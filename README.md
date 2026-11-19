# CreateStudio

A browser-based studio for photos, video and product imagery:
- a layered **Photo Editor** with GPU colour grading and looks;
- a multitrack **Video Editor** with titles, subtitles, transitions and MP4/WebM export;
- **Compress Video**, which shrinks videos on-device, measures each result against the original, and never keeps a bigger file;
- a batch **Product Studio** that cuts products out on-device and lays them out at marketplace sizes;
- templates, a brand kit, and AI tools (on-device, plus an optional cloud provider).

It is local-first. Projects and media stay in the browser (IndexedDB), and video is encoded on the device with WebCodecs. The server is needed only for optional cloud AI, and it keeps the API key private.

The product name is configurable. Set `NEXT_PUBLIC_APP_NAME` before building.

- **Feature status, architecture, known issues and roadmap:** [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md)
- **Planned server database:** [docs/schema.sql](docs/schema.sql)

## Requirements

- **Node.js 20.9 or newer.** Developed on Node 24.
- **A Chromium browser (Chrome or Edge, current version) is recommended.**
  - Everything works there, including WebCodecs export, WebGL2 and **Save all to folder**.
  - Firefox and Safari can edit. Their video export depends on their WebCodecs support; the export dialog offers only the sizes the browser can actually encode.
- **HTTPS (or `localhost`).** WebCodecs and the File System Access API only work in a secure context.

## Install and run

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Open http://localhost:3000. No account and no API key are needed for any on-device feature.

The first background removal in a tab downloads about 95 MB from IMG.LY's CDN: the 84 MB model and an 11 MB engine. The CDN lets the browser cache them for 4 hours.

## Configuration

All settings are environment variables. `.env.example` lists every one. Put real values in `.env.local`, which is git-ignored, or in your host's secret settings.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | Branding | Public. It is inlined at **build** time, so set it before `npm run build`. |
| `OPENAI_API_KEY` | Text to image, generative edit, auto subtitles | Server only, never sent to the browser. Without it, those features show setup instructions and stay disabled. |
| `OPENAI_IMAGE_MODEL` | Optional | Default `gpt-image-1`. |
| `OPENAI_TRANSCRIBE_MODEL` | Optional | Default `whisper-1`. |
| `AI_PROVIDER` | Optional | Provider id to prefer when several are configured (`openai`). |
| `AI_RATE_LIMIT_PER_MIN` | Optional | Cloud AI requests allowed per client IP per minute. Default `10`. |

Settings → **AI providers** shows which cloud capabilities the server has enabled. It never shows key values.

## Using it

| Area | Route | What it does |
| --- | --- | --- |
| Home | `/` | Start a photo or video, pick a social size preset, open recent projects |
| Photo Editor | `/photo` | Layers, crop and straighten, 22 adjustments, 36 looks, text and shapes, masks, clone, AI tab, PNG/JPEG/WebP export |
| Video Editor | `/video` | Multitrack timeline, trim and split, text presets, `.srt`/`.vtt` import, transitions, colour and LUTs, MP4/WebM export up to 4K |
| Compress Video | `/compress` | Batch-shrink videos: Visually lossless, Balanced, Smallest or a target size; H.264, HEVC, AV1 or VP9; audio copied when possible; an SSIM quality check and a before/after Compare |
| Product Studio | `/product` | Batch cut-outs, marketplace presets, backdrops and shadows, download all or save to a folder |
| AI Tools | `/ai` | On-device background removal; cloud text to image and generative edit (needs a key) |
| Templates | `/templates` | 7 editable templates at any social size, coloured with your brand palette |
| Brand Kit | `/brand` | Brand colours, logo and fonts, used across the editors |
| My Projects | `/projects` | Rename, duplicate, trash, restore, delete permanently |
| Export History | `/exports` | Every file exported from this browser, ready to download again |
| Settings | `/settings` | Theme, storage usage, AI provider status, device capabilities |

**Photo Editor shortcuts:**
- Tools: V (move), H (pan), C (crop), T (text), U (shape), B (brush), E (eraser), S (clone).
- `[` and `]` change brush size. `\` toggles the before/after compare.
- Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo, Ctrl+S save, Ctrl+D duplicate layer, Ctrl+0 fit.

**Video Editor shortcuts:** Space (play), S (split), ← and → (frame step), Home and End.

## Data model

The current build stores everything in the browser, in the IndexedDB database `createstudio` (version 1).

| Store | Key | Contents |
| --- | --- | --- |
| `projects` | `id` | Name, kind (`photo` or `video`), size, timestamps, trash flag (`deletedAt`), WebP thumbnail. `data` holds the **edit instructions**: a `PhotoDoc` (layers) or a `VideoProject` (tracks and clips). |
| `assets` | `id`, indexed by `projectId` | Original media as Blobs (image, video, audio), plus mask bitmaps and LUTs. Never modified, which is what keeps editing non-destructive. |
| `exports` | `id` | Export history: file name, type, size, dimensions, and the file itself up to 512 MB. |
| `kv` | string key | `brand-colors`, `brand-fonts`, `brand-logo`, `photo-presets`. |

Clearing site data in the browser deletes all of this. Settings can ask the browser for persistent storage, which protects it from automatic eviction.

`docs/schema.sql` is the PostgreSQL schema for the accounts and sync phase. It is **not used yet**. Its tables mirror the stores above, so local projects can be uploaded as they are.

## Testing

### Static checks (run before every commit)

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

### API guard checks

Run these against a dev server with no API key configured.

```bash
curl -s http://localhost:3000/api/ai/status
```
Expected: JSON capability flags, with no key values.

```bash
curl -s -X POST -H "Content-Type: application/json" --data '{"prompt":"x"}' http://localhost:3000/api/ai/image
```
Expected: `400` with a validation message.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" --data '{"prompt":"a red bottle","size":"1024x1024"}' http://localhost:3000/api/ai/image
```
Expected: `403`.

```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST -H "Content-Type: application/json" -H "X-Forwarded-For: 203.0.113.$i, 10.0.0.1" --data '{"prompt":"a red bottle","size":"1024x1024"}' http://localhost:3000/api/ai/image; done
```
Expected: `503` until the limit, then `429`. Forging the first hop must not reset the limit.

### Browser checks

There is no automated end-to-end suite yet; Playwright is the next task in DEVELOPMENT_PROGRESS.md. Development so far used scripted checks in the browser:
- test media is generated in the page, with a canvas and `MediaRecorder` for video;
- it is injected through the file inputs with `DataTransfer`;
- results are verified by decoding the exported files and reading IndexedDB.

To repeat them by hand:

| Flow | Steps | Expected |
| --- | --- | --- |
| Photo export | New photo, add an image, raise Saturation, Export as JPEG | The file opens; colours are visibly more saturated; it appears in Export History |
| Non-destructive edits | Apply a look, save, reload the project | The look and intensity are restored; the original asset is unchanged |
| Background removal | Photo Editor → AI → Remove background | Download progress, then "Analysing image", then the subject on transparency, as an editable mask. While it runs, the page still scrolls and changes pages |
| Template | Templates → pick a size → click a template card | A project with editable text and shape layers in the brand colours |
| Video import and split | New video, import a clip, add it, select it, move the playhead, press S | Two clips; the second starts where the first ends, with the source offset carried over |
| Subtitles | Video → Text → Import .srt | A "Subtitles" track with one text clip per cue |
| Video export | Export → WebM or MP4 → 720p | Progress climbs with real frame counts; the file plays at the right length, with audio |
| Export in the background | Start a long export, press the browser's Back button, wait | The file downloads and a toast says so; Forward shows the result in the export dialog |
| Leave warning | Start a video export, a compression or a Product Studio batch, then reload the tab | The browser asks whether to leave. Once the work has finished or been cancelled, reloading does not ask |
| Preset size kept | Home → Instagram Reel → import a landscape clip | The project stays 1080×1920 |
| Compress, visually lossless | Compress Video → add a video recorded on a phone | A smaller file with "audio copied", a "No visible difference expected" line with its SSIM, and Compare showing both frames |
| Compress, nothing to gain | Add a video that is already efficiently compressed, for example a download | "No saving… the original was kept", with a tip for what to try |
| Compress, target size | Target size → 10 MB → add a larger video | A result of at most 10,000,000 bytes, or a note that it is still above the target after a second pass |
| Product Studio | Add two product photos, choose Amazon, Download all | Two 2000×2000 JPEGs on pure white; product colours unchanged; no specks |
| Trash | My Projects → Move to trash → Trash tab → Restore, then Delete permanently | The project returns, then is gone together with its media |
| Brand logo | Brand Kit → Upload logo (an SVG is refused) → Photo Editor → Brand logo | The logo appears as a new layer |
| No-key behaviour | AI Tools → Text to image, with no key set | A notice explains the setup; Generate is disabled |

## Deployment

Build once and serve with Node:

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

`npm start` listens on port 3000; set `PORT` to change it. Serve over **HTTPS**, because video export and Save to folder need a secure context.

### Behind a reverse proxy (nginx example)

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;              # the AI rate limiter keys on this
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 30m;                             # AI uploads are capped at 20 MB (image) and 25 MB (audio)
}
```

### Vercel and other serverless hosts

This works as a standard Next.js project. Add the environment variables in the project settings.

Serverless functions limit request and response size: Vercel caps them at 4.5 MB at the time of writing. On those hosts, large generative-edit uploads and long transcriptions will fail. Self-host if you need the full limits.

The rate limiter is held in memory per instance. On multi-instance or serverless hosts, treat it as best effort until it is backed by Redis or the database.

### Before exposing a deployment with an AI key

The cloud AI routes check the request origin and rate-limit by IP, but **there are no user accounts yet**. Anyone who can reach the server can use the key's quota. Until the accounts phase lands, protect the deployment with access control: your host's password protection, proxy basic auth, or a VPN.

## Security notes

- API keys are read only in `src/lib/ai/server.ts`, which is a `server-only` module and so cannot be bundled into the client.
- Uploads are checked for type and size in the browser, and again in every API route; see `src/config/app.ts` and the routes.
- Response headers include `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` and a restrictive `Permissions-Policy`. A Content-Security-Policy is still to do (see DEVELOPMENT_PROGRESS.md).

## Licences

`@imgly/background-removal`, which powers on-device segmentation, is licensed **AGPL-3.0**. If you distribute this app as closed source, get IMG.LY's commercial licence or replace the model.

Fonts uploaded to the Brand Kit must be licensed for your use.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4.
- Zustand for state, and zod for validation in the API routes.
- Mediabunny (WebCodecs) for video, and `@imgly/background-removal` (ONNX Runtime Web, in a Web Worker) for segmentation.
- The photo engine is custom: Canvas 2D for compositing and WebGL2 for colour.
