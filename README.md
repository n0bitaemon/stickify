# Stickify

Convert, manage and create stickers for **Telegram, WhatsApp, Apple iMessage, Signal, Discord, Viber and Facebook Messenger**.

- **Pick a source platform**. Each one takes its own kind of input (see [section 5](#5-source-platforms)):
  - **Files**: drag and drop PNG / JPG / WebP / **SVG** / **GIF** / **APNG** / **WebM / MP4 / MOV** / ZIP
  - **Telegram**: paste a `t.me/addstickers/…` link (e.g. `https://t.me/addstickers/deathclickk`), or send stickers to the bot
  - **Signal**: paste a `signal.art/addstickers/#pack_id=…&pack_key=…` link; the pack is downloaded and decrypted from Signal's CDN
  - **WhatsApp**: upload `.wastickers` / `.zip` / `.webp` files; the pack name, author and emojis are kept
- **Review before anything is saved.** Every link and upload opens a review grid: zoom in, untick what you don't want, and in Quick Convert compare each sticker with **how it will look on the target platform**. Lottie (`.tgs`) stickers are rendered in the browser.
- **Automatic per-platform formatting:** square canvas, transparent background, compression to fit each size limit, duration/FPS cuts
- Sticker outline (width and colour), auto-trim, padding
- **Live preview** of exactly the file that will be exported, with a size bar against the limit
- **Export** as ZIP (WhatsApp: ready-to-import `.wastickers` files, auto-split into static/animated packs of at most 30), download single stickers, or **push straight to Telegram** through the bot
- **Step-by-step guides behind a "How to…" button**, both for getting stickers out of a source and for importing the export into each target platform (the same steps are written into the ZIP's README)
- Conversion history in MongoDB, so you can download any ZIP again
- Quick convert without an account

**Tech stack:** Node.js + TypeScript, Express 5, MongoDB (Mongoose), sharp, ffmpeg (fluent-ffmpeg), React 19 + Vite + Tailwind CSS v4.

---

## 1. Getting started

You need **Node.js ≥ 20.11**, **MongoDB** and **ffmpeg** built with `libvpx` (Homebrew and Debian/Ubuntu builds include it).

```bash
cp .env.example .env          # set JWT_SECRET, optionally TELEGRAM_BOT_TOKEN
npm run setup                 # installs server/ and web/ dependencies
docker compose up -d mongo    # or use an existing MongoDB
npm run dev                   # API on :4000 + UI on :5173 (Vite proxies /api → :4000)
```

Open http://localhost:5173.

Production: `npm run build && npm start`. Express then serves the built UI at http://localhost:4000.
Or run everything in Docker: `JWT_SECRET=$(openssl rand -base64 32) docker compose up --build`.

```bash
npm test          # 53 tests: domain, media engine (real sharp/ffmpeg), Signal/WhatsApp/APNG sources, review sessions, Telegram client (mocked fetch)
npm run typecheck
```

### Enabling Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) and put its token in `TELEGRAM_BOT_TOKEN`.
2. **Importing by link** only needs the token. Signal and WhatsApp need no configuration at all.
3. The **sticker-receiving bot** and **Push to Telegram** need a linked account: open the *Telegram* page → *Link with Telegram* → press **Start** in the bot. The bot uses long polling, so no public domain or HTTPS is required.

---

## 2. Project structure (Clean Architecture)

Dependencies only point **inwards**: `interfaces → application → domain`. `infrastructure` implements the *ports* the application layer defines. Only `container.ts` knows which concrete classes are used.

```
stickify/
├── server/
│   ├── src/
│   │   ├── domain/                      # Pure business core, no library dependencies
│   │   │   ├── platforms.ts             #   Specs + import guides of the 7 TARGET platforms
│   │   │   ├── sources.ts               #   SOURCE platforms + input kind (files / link / archive) + guides
│   │   │   ├── media.ts                 #   MediaInfo, ProcessingOptions, formats
│   │   │   └── errors.ts                #   AppError, NotFound, Validation, MediaError...
│   │   ├── application/
│   │   │   ├── ports/                   #   MediaProcessorPort, StoragePort, StickerSourceProvider
│   │   │   └── services/                #   Use cases
│   │   │       ├── remote-preview       #     review sessions for links AND uploads, target renders
│   │   │       ├── source-registry      #     link providers, link detection
│   │   │       ├── import               #     review → new pack (background) / existing pack
│   │   │       ├── convert              #     quick convert, nothing stored
│   │   │       ├── sticker-ingest       #     probe → dedupe → store original + thumbnail
│   │   │       ├── pack                 #     pack CRUD, reorder, emojis
│   │   │       ├── rendition            #     per-platform conversions + cache
│   │   │       ├── export               #     background export jobs, ZIP, history
│   │   │       ├── telegram-publish     #     push a pack to Telegram
│   │   │       ├── telegram-account     #     account linking with one-time codes
│   │   │       ├── auth                 #     sign up / sign in (JWT)
│   │   │       └── zip-builder          #     per-platform ZIP layout (.wastickers, README...)
│   │   ├── infrastructure/
│   │   │   ├── media/                   #   Image/video engine
│   │   │   │   ├── probe.ts             #     magic bytes + metadata (incl. APNG chunks)
│   │   │   │   ├── sharp.processor.ts   #     stills/SVG/GIF/WebP, WebP/PNG/GIF encoders
│   │   │   │   ├── ffmpeg.processor.ts  #     video/APNG decoding, WebM VP9 / APNG encoders
│   │   │   │   ├── frames.ts            #     RGBA frame sequences, FPS resampling, outline (EDT)
│   │   │   │   ├── fit.ts               #     compress-to-fit loop
│   │   │   │   └── sticker.processor.ts #     orchestration, implements MediaProcessorPort
│   │   │   ├── sources/                 #   Link providers: telegram.source, signal.source (+ Signal CA)
│   │   │   ├── archive/                 #   .wastickers/.zip reader (fflate, zip-bomb safe)
│   │   │   ├── db/                      #   Connection + Mongoose models
│   │   │   ├── storage/local.storage.ts #   StoragePort on disk (swap for S3)
│   │   │   ├── telegram/                #   Bot API client + long-polling bot
│   │   │   └── queue/task-queue.ts      #   Limits concurrent heavy work
│   │   ├── interfaces/http/             # Express: routes, controllers, middlewares, zod schemas
│   │   ├── config/                      # env (validated with zod), logger (pino)
│   │   ├── container.ts                 # Composition root (manual DI)
│   │   └── main.ts                      # Startup, interrupted-job cleanup, graceful shutdown
│   └── test/
├── web/                                 # React + Vite + Tailwind v4
│   └── src/
│       ├── pages/                       # Dashboard, PackEditor, Import, QuickConvert, History, Telegram, Auth
│       ├── components/                  # SourceStage, PackReview, GuideButton, StickerGrid, LivePreview...
│       └── lib/                         # API client, auth context, hooks, review state, toasts
├── Dockerfile · docker-compose.yml · .env.example
```

> **A deliberate trade-off:** application services use the Mongoose models directly instead of a repository layer. Three simple entities are not worth twice the code. The parts that really can be swapped (media, storage, sources, Telegram) all go through ports or adapters.

---

## 3. Database schema (MongoDB / Mongoose)

| Collection | Role | Main fields | Indexes |
|---|---|---|---|
| **users** | Accounts | `email` (unique), `passwordHash` (`select:false`, bcrypt 12), `displayName`, `telegram {userId, username, linkedAt}`, `telegramLinkCode {code, expiresAt}`, `preferences {defaultPlatform, processing}`, `storageBytes` | `email` unique · `telegram.userId` unique (partial) |
| **stickerpacks** | Packs | `owner`, `title`, `author`, `defaultEmoji`, `source {type: upload\|link\|archive\|bot, platform: file\|telegram\|signal\|whatsapp, externalId}`, `importState {status, done, total}`, `processing`, counters `stickerCount/animatedCount/totalBytes`, `coverItem`, `telegramPublished {setName, url}` | `{owner, updatedAt:-1}` |
| **stickeritems** | Stickers | `pack`, `owner`, `position`, `emojis[]`, `original {key, format, kind, mime, bytes, width, height, frames, durationMs, codec}`, `thumbnail`, `contentHash` (SHA-256), `telegram {fileId}` | `{pack, position}` · `{pack, contentHash}` |
| **exportjobs** | Conversion history | `owner`, `pack`, `packTitle` (snapshot), `platform`, `target: zip\|telegram`, `options`, `status`, `progress`, `result {key, filename, bytes, telegramUrl}`, `warnings[]`, `error` | `{owner, createdAt:-1}` · `{pack, createdAt:-1}` |

**Why StickerItem is its own collection** rather than embedded in the pack: a pack holds up to 200 stickers with technical metadata, which get reordered and deleted one by one. Embedding them would bloat the document and rewrite the whole array on every change. The pack keeps denormalised counters so the dashboard never has to count.

**Renditions** (conversions for each platform) **are not stored in the DB**. They are cached in storage under the deterministic key `packs/<pack>/items/<item>/renditions/<platform>-<hash(spec+options)>`, so the live preview, ZIP export and Telegram push reuse the same file.

**Review sessions** live in memory (`RemotePreviewService`): 15-minute time-to-live, 300MB total, least recently used dropped first. An evicted session only means the stickers have to be loaded again.

---

## 4. Media engine

```
                 ┌─ static/SVG ──► sharp: EXIF rotate → trim → contain → pad → outline ─► WebP/PNG (compress-to-fit)
probe (magic) ───┼─ GIF/WebP anim ► sharp decodes each frame ┐
                 ├─ WebM/MP4/MOV/APNG ► ffmpeg (libvpx keeps alpha) ┴─► FrameSequence (RGBA, constant FPS)
                 │                                                   ├─► sharp  → animated WebP / GIF
                 │                                                   └─► ffmpeg → WebM VP9 / APNG
                 └─ .tgs Lottie ──► passed through (exported back to Telegram only)
```

- **File extensions are never trusted.** Formats are detected from magic bytes, so a `.png` that is really an animated GIF is still handled correctly.
- **SVG** is rasterised at about 2× the target size and then scaled down, which keeps edges crisp.
- **The sticker outline** uses an exact *Euclidean Distance Transform* (Felzenszwalb, O(n), ~10ms per frame). It is evenly wide with rounded corners, without the thin tips that "blur + threshold" produces.
- **Compress to fit:** settings go from high to low quality (WebP lossless → q92 → … → q20; WebM by CRF and bitrate; APNG RGBA → 8-bit palette → lower FPS). The engine stops at the first result under the limit, or returns the smallest one with a warning.
- **Telegram video stickers:** VP9 `yuva420p`, no audio, ≤ 3s, ≤ 30fps, ≤ 256KB. ffmpeg's default decoder **drops VP9 alpha**, so the engine forces `libvpx-vp9` when decoding.
- **Performance:** `mediaQueue` limits concurrent sharp/ffmpeg work and `jobQueue` runs background jobs. They must stay separate: a background job waiting on media work in the same queue would deadlock. One sticker holds at most 150 frames in RAM; long clips lower their FPS.

| Platform | Canvas | Static | Animated | Pack |
|---|---|---|---|---|
| Telegram | 512×512 | WebP ≤ 512KB | WebM VP9 ≤ 256KB, 3s | ≤ 120, mixed |
| WhatsApp | 512×512 | WebP ≤ 100KB | WebP ≤ 500KB, 10s | 3–30, static/animated split, 96×96 tray, `.wastickers` |
| iMessage | 408×408 | PNG ≤ 500KB | APNG ≤ 500KB | – |
| Signal | 512×512 | WebP ≤ 300KB | APNG ≤ 300KB | – |
| Discord | 320×320 | PNG ≤ 512KB | APNG ≤ 512KB | – |
| Viber | 490×490 | PNG | (first frame) | – |
| Messenger | 512×512 | PNG | GIF | sent as images |

Specs and import guides live in [server/src/domain/platforms.ts](server/src/domain/platforms.ts). When a platform changes its rules, that is the only file to edit.

---

## 5. Source platforms

Each platform shares stickers differently, so each source declares its own **input kind** in [server/src/domain/sources.ts](server/src/domain/sources.ts). The UI builds its forms from that list (`GET /api/sources`).

| Source | Input | How it works |
|---|---|---|
| **Files** | `files` | Drag and drop; ZIPs are unpacked automatically. |
| **Telegram** | `link` | `t.me/addstickers/<name>` / `t.me/addemoji/<name>` → Bot API `getStickerSet` + `getFile`. Needs `TELEGRAM_BOT_TOKEN`. Stickers can also be sent to the bot. |
| **Signal** | `link` | `signal.art/addstickers/#pack_id=…&pack_key=…` → downloads `manifest.proto` and each sticker from `cdn.signal.org` (using Signal's own CA), then HKDF-SHA256 → HMAC check → AES-256-CBC decryption, and reads the protobuf for title, author and emojis. The `pack_key` is **never** stored. |
| **WhatsApp** | `archive` | WhatsApp has no pack share links. Takes `.wastickers` / `.zip` (sticker maker app format) or loose `.webp` files, and reads `title.txt`, `author.txt` and `contents.json` to keep the pack name and emojis. |

**Every source goes through a review session.** Links are loaded with `POST /api/import/inspect`; files are uploaded with `POST /api/import/upload-preview` (archives unpacked, every file probed, invalid files reported). The UI then shows each sticker from `GET /api/import/previews/:id/stickers/:index` (files are served with a sandbox CSP, since uploads may be SVG). Quick Convert can also render any sticker for the target platform with `…/render?platform=`. Import and convert send the `previewId` plus the selected `indices`, so nothing is downloaded or uploaded twice.

**Adding a source:** write a class implementing `StickerSourceProvider` (`parse(link)` + `fetchPack(ref)`), register it in `container.ts` and add its spec to `sources.ts`. Import, quick convert and the Telegram bot (which detects links in messages) pick it up automatically.

Signal's animated stickers are **APNG**. The engine detects them from the `acTL`/`fcTL` chunks (sharp only reads the first frame and ffprobe reports no duration) and decodes them with ffmpeg.

> **LINE is not supported:** it would be technically possible, but most LINE stickers are paid content, and downloading them from the CDN bypasses the purchase.

---

## 6. REST API

Every error has the same shape: `{ "error": { "code", "message", "details?" } }`. Authentication uses the httpOnly cookie `stk_token` or an `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` · `/api/platforms` · `/api/sources` | System status · target platform specs + import guides · source platforms + guides |
| POST | `/api/auth/register` · `/login` · `/logout` | Accounts |
| GET/PATCH | `/api/auth/me` | Profile and default options |
| POST | `/api/import/inspect` | Loads a pack from a link for review `{ source, link }` → `previewId`, title, counts, `stickers[{index, emojis, kind, filename}]` |
| POST | `/api/import/upload-preview` | Uploads files for review (multipart `files[]`, `source`, optional `previewId` to append) → same shape + `failed` |
| GET | `/api/import/previews/:previewId/stickers/:index` | The original file of one reviewed sticker |
| GET | `/api/import/previews/:previewId/stickers/:index/render?platform=…` | That sticker converted for a target platform (metadata in `X-Stickify-*` headers) |
| POST | `/api/import/preview` | Creates a new pack from a review `{ previewId, indices?, title? }` → **202**, poll `GET /api/packs/:id` |
| POST | `/api/import/link` | Imports straight from a link without a review step (API clients, used by the bot) |
| POST | `/api/convert` | **Quick convert** (multipart: `previewId` + `indices`, or `source` + `link`, or `files[]`; plus `platform`, `trim`, `padding`, `borderWidth`, `borderColor`) → **ZIP**. `X-Stickify-Failed` lists failures |
| GET/POST | `/api/packs` | List / create packs |
| GET/PATCH/DELETE | `/api/packs/:id` | Details (with stickers) / update / delete |
| POST | `/api/packs/:id/stickers/from-preview` | Adds the selected stickers of a review `{ previewId, indices? }` |
| POST | `/api/packs/:id/stickers` | Direct upload (multipart `files[]`) for API clients |
| PUT | `/api/packs/:id/order` | Reorder `{ ids: [...] }` |
| PATCH/DELETE | `/api/stickers/:id` | Edit emojis / delete |
| GET | `/api/stickers/:id/preview?platform=…` | **Live preview** of a pack sticker |
| GET | `/api/stickers/:id/download?platform=…` | Download one converted sticker |
| GET | `/api/stickers/:id/thumbnail` · `/original` | Thumbnail · original file |
| POST | `/api/packs/:id/exports` | **Export** `{ platform, target: zip\|telegram, options }` → **202** + job |
| GET | `/api/exports[?packId=]` · `/api/exports/:id` | History · job status (poll) |
| GET | `/api/exports/:id/download` | Download the ZIP again |
| GET | `/api/telegram/status` | Bot configured? Account linked? |
| POST/DELETE | `/api/telegram/link-code` · `/api/telegram/link` | Create a linking deep link · unlink |

Example flow (*load → review → convert*):

```bash
# 1. Load a pack for review (or POST /api/import/upload-preview with files)
curl -s -X POST http://localhost:4000/api/import/inspect \
  -H 'content-type: application/json' \
  -d '{"source":"telegram","link":"https://t.me/addstickers/deathclickk"}'      # → { "previewId": "…", "stickers": [...] }

# 2. Convert only stickers 0, 3 and 5 for WhatsApp
curl -X POST http://localhost:4000/api/convert \
  -F previewId=$PREVIEW_ID -F indices=0,3,5 -F platform=whatsapp -F borderWidth=10 -o pack.zip

# Or in one step, from a link or from files
curl -X POST http://localhost:4000/api/convert -F source=telegram -F link=https://t.me/addstickers/deathclickk -F platform=signal -o pack.zip
curl -X POST http://localhost:4000/api/convert -F platform=whatsapp -F files=@cat.png -F files=@dance.gif -o pack.zip
```

---

## 7. User interface

```
┌──────────────┬─────────────────────────────────────────────┬───────────────────────────┐
│ ✦ Stickify   │ 1 · SOURCE                                   │ 2 · TARGET  How to import…│
│              │ [▣ Files] [✈ Telegram] [◯ Signal] [▢ WhatsApp]│ [● Telegram] [● WhatsApp] │
│ ▦ Packs      │ Paste a sticker pack link     How to get it ⓘ│ [● iMessage] [● Signal]…  │
│ ⇩ Import     │ [ https://t.me/addstickers/…    ][Load pack] │ ┌ Static  WEBP ≤ 100KB ───┐│
│ ⚡ Convert    │ ┌──────────────────────────────────────────┐ │ │ Animated WEBP ≤ 500KB  ││
│ ⟲ History    │ │ ✈ DeathClick · 31 stickers               │ │ └ Per pack 3–30 ─────────┘│
│ ✈ Telegram   │ │ 26 of 31 selected   [Select all][None]   │ │ ADJUSTMENTS ☑ Auto-trim   │
│              │ │ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐                 │ │ Padding  ──●──── 8px      │
│              │ │ │☑ ││☑ ││☐ ││☑ ││☑ ││☐ │ ← click to pick │ │ Outline  ────●── 10px     │
│              │ │ └──┘└──┘└──┘└──┘└──┘└──┘   ⤢ zoom:      │ │ Telegram → WhatsApp       │
│              │ │   Original │ On WhatsApp (93KB/100KB)   │ │ [Convert 26 stickers ⇩]  │
│ ┌──────────┐ │ └──────────────────────────────────────────┘ │                           │
│ │ M Minh Anh│ │                                              │                           │
└──────────────┴─────────────────────────────────────────────┴───────────────────────────┘
```

UX principles:

- **One flow everywhere:** source → review → action. Import, quick convert and adding files to a pack all use the same review grid.
- **Guides stay out of the way:** source and target instructions sit behind a small "How to…" button and open in a dialog.
- **See before you commit:** the review renders the real files (including Lottie), and in Quick Convert the zoom view puts the original next to the target-platform result, with its size against the limit.
- **Immediate feedback:** the live preview is rendered by the server, so it is exactly the file you will download. The size bar turns green/amber/red against the limit, and warnings don't block (duration cut, motion lost…).
- One failing file never ruins a batch: each rejected file comes with a reason.
- Light/dark follows the OS, there is a bottom tab bar on mobile, the drop zone and pickers work with the keyboard, and controls have `aria-label`s.

---

## 8. Security & operations

- Passwords use bcrypt (cost 12). Unknown emails are compared against a dummy hash, so response times don't reveal which emails exist.
- The JWT (HS256) lives in an httpOnly, SameSite=Lax cookie (Secure in production). Other users' resources return **404**, not 403.
- Helmet CSP; user-supplied files (originals, review files) are served with a **sandbox CSP**, so an uploaded SVG cannot run scripts on our origin.
- Rate limits on auth, convert, import and preview rendering; 1MB JSON bodies; upload size and count limits.
- Storage keys are strictly validated and never come from the client; writes are atomic (temp file + rename).
- `.tgs` decompression and archive extraction are size-capped (zip bombs). The Telegram token never appears in logs or error messages.
- On restart, interrupted jobs/imports are marked failed so the UI never hangs; SIGTERM shuts down gracefully.

## 9. Current limitations & next steps

- **Lottie `.tgs`** can be previewed in the browser but only exported to Telegram (passed through). Converting to other platforms needs a server-side renderer such as rlottie.
- Queues and review sessions live in memory, which suits a single instance. To scale horizontally, swap `TaskQueue` for BullMQ + Redis, keep review sessions in Redis/S3, and replace `LocalStorage` with S3/R2 (only `container.ts` changes).
- No automatic background removal for photos yet, and no per-user storage quota (the `storageBytes` field is already there).
