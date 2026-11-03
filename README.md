# Pose Book Studio (v1, local build)

A multi-category AI image reference composer, built in the *pattern* of a
reference studio (category slots, reference collage, structured prompt,
direct generation with the user's own key) — with more categories than
the classic 3-slot studio.

**No code, text, or images were copied from the reference studio, and no
images from it were downloaded or mirrored.** Its licence covers its code
only; its images/data remain the original author's and are non-commercial.
This project's image data comes from Shisei (CC0) via the import script
below.

## Categories (v1)

- Gallery (Shisei, CC0): pose, costume, scene, furniture, prop, light, animal
- Portrait slot: **no images shipped** — the portrait source is unresolved,
  so the slot only accepts a user-uploaded file or a pasted image URL, with
  a clear placeholder note in the UI.
- Style slot: built-in generic text presets only. The handraw 367-style
  library is **not** imported in v1; no handraw data is invented here.

## Run

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # outputs dist/
```

## Generate the catalog (required for the gallery)

The app loads `./catalog.json` at runtime. It is not in the repo: you
generate it (plus `assets/`) from a local Shisei checkout, into `public/`
so Vite serves it in dev and copies it into `dist/` on build:

```sh
cd public
node ../scripts/import-shisei.mjs /path/to/shisei
cd ..
npm run dev
```

The import script only copies images that actually exist upstream and
writes `catalog.json` in this shape:

```json
{ "id": "P001", "type": "pose", "name": "…", "names": { "ja": "…", "en": "…", "ko": "…" },
  "category": "…", "rating": "general", "description": "…",
  "variants": { "front": { "line": { "w300": "assets/line/w300/…", "w900": "…" } } } }
```

Pose layers are line/clay/depth/normal/photo; the other types have a
single `image` layer. If `catalog.json` is missing, the gallery shows
these import instructions instead of crashing. Do not double-click the
built HTML file — serve it over HTTP so `catalog.json` can load.

## Studio (v1)

- One slot per category (portrait-upload, pose, costume, scene, furniture,
  prop, light, animal, style-text) plus unlimited custom reference uploads
  or pasted URLs.
- Structured prompt, assembled in a fixed order: style → scene → light →
  pose → costume → furniture → prop → animal → portrait note, in English
  from each item's description (falling back to id/name), with a copy button.
- Canvas collage export (PNG download) of the chosen references. Pasted
  remote images may taint the canvas on CORS; if that happens the app says
  so and suggests uploading the file instead.

## Generation — v1 uses ONLY the user's own API key

Settings offers: Google Gemini, OpenAI GPT Image, Alibaba Qwen, ByteDance
Doubao, local ComfyUI. Model names are editable; sensible defaults are
pre-filled. The key is a password field stored **only in the browser's
localStorage**. It is never sent to our server, never written to the repo,
and is only sent to the provider the user chose, at generation time.
There is **no official key in v1** — that would need a separate backend
(billing, proxy, abuse controls) and is deliberately not built here.

- Gemini: `POST /v1beta/models/{model}:generateContent` with
  `x-goog-api-key`, reference images as `inlineData` parts.
- OpenAI: `/v1/images/generations` without references, `/v1/images/edits`
  (multipart) with references; result is `b64_json` or a URL.
- Qwen (DashScope): `POST /api/v1/services/aigc/multimodal-generation/generation`
  with `messages` containing image + text parts; result image URL under
  `output.choices[].message.content[].image`.
- Doubao (Volcengine Ark): `POST {base}/images/generations` (default
  `https://ark.cn-beijing.volces.com/api/v3`), `response_format: 'url'`.
  Limitation: Ark references normally need publicly reachable URLs; data
  URLs are sent and may be rejected by some models — provider errors are
  shown as-is, never faked into a success.
- ComfyUI: needs a user-pasted `.api.json` workflow containing a
  `__PROMPT__` placeholder. The app uploads references to `/upload/image`,
  fills `LoadImage` nodes in order, submits to `/prompt`, polls
  `/history/{prompt_id}`, and fetches the first output via `/view`.
  Without a workflow it errors clearly instead of inventing a result.

Generation history (prompt + result image or error + timestamp) is saved
to localStorage only.

## What is NOT in v1

- No portrait images, no handraw style data (see above).
- No official/shared API key, no server, no accounts, no payments.
- No live generation test: generation calls were implemented from the
  public endpoint shapes above but **not** run against a real key, so
  first-run provider errors should be expected and reported verbatim.
- Suggestive items (Shisei `rating: 'suggestive'`) are hidden by default
  and only shown when the user opts in.

## Adding portrait / style data later

- Portrait: add a licensed source, import it into the same catalog shape
  with `type: 'portrait'`, and replace the upload-only slot with a gallery
  picker. Do not drop in images whose licence you have not checked.
- Style: import the style list as data (id, label, English fragment) and
  replace `STYLE_PRESETS` in `src/lib.ts` with it; the prompt assembler
  already reads the style fragment first.
