---
name: app-store-header-video
description: |
  Create, render, and verify App Store creative-asset videos — the looping product
  page header (21:9, 3840x1646) and the search results header (3:2, 1920x1280 to
  3840x2560). Use this skill when the user asks for an "App Store header video",
  "product page header", "search results header", "App Store creative asset",
  a looping store banner video, or a 3840x1646 / 3840x2560 App Store video.
  Builds with HyperFrames (HTML to video), generates supporting imagery when
  needed, then conforms and verifies the file against Apple's spec so the user
  can upload it themselves. Do NOT use for classic app preview videos (device
  screen recordings, 886x1920, 15-30s, max 30fps), for static store screenshots
  (use the app-store-screenshots skill), or for Google Play feature graphics.
---

# App Store Header Video

Build the two App Store **creative asset** videos: the product page header that
loops above the app icon, and the search results header that plays on the app
card in search. Both autoplay muted and loop forever, so every frame has to
work without sound and the last frame has to flow into the first.

**This skill prepares the file. It never uploads or submits anything** — the
user publishes in App Store Connect.

## Inputs to collect

Ask only for what is missing; the conversation usually supplies some already.

1. **Placement(s)** — header (21:9), search results (3:2), or both. Each has
   different dimensions, so a header render cannot be reused as-is for search.
2. **The one idea** — one sentence the video must land. Apple's own guidance:
   "Focus on a single, clear idea." Two ideas means neither lands.
3. **App identity** — app name, one-line value proposition, brand colors, logo
   file, app icon PNG.
4. **Real product material** — screenshots or footage of the actual app, if the
   concept shows the app. Creative assets may highlight brand or content
   instead of the app in use, so this is optional, but when the app is shown it
   must be real captures.
5. **Length** — default 8 seconds. Apple accepts 5–30s.
6. **Occasion** — evergreen, seasonal launch, feature drop, rebrand. Affects
   whether the asset can be reused later.

## Procedure

This skill's scripts live in `scripts/` next to this file. Resolve that path
against this SKILL.md's own directory whenever you run them — the user's
working directory is not the skill directory.

### 1. Lock the placement and read the spec

Read `references/specs.md` before building. It carries Apple's exact tables,
the app-preview vs creative-asset distinction, and the safe-area rules.

If the `asc` CLI is on PATH, `asc asset-library specs` returns Apple's live
reference data — use it to confirm the numbers have not moved since this
skill was written. `references/publishing.md` has the query.

The two placements are not interchangeable:

| Placement | Aspect | Size | Typical use |
|---|---|---|---|
| Product page header | 21:9 | exactly 3840x1646 | full-width banner above the icon |
| Search results | 3:2 | 1920x1280 to 3840x2560 | the card in search results |

### 2. Pick one idea and name the poster frame

Write down the single idea and the poster frame — the still a user sees before
playback starts, and the frame Apple shows when autoplay is off. The poster
frame must stand alone as a static image. "Lead with your value proposition or
most compelling feature" (Apple). If the poster frame needs a caption to make
sense, the idea is not finished yet.

### 3. Design the seam, not a clip

The video loops continuously and people watch it repeatedly, so the state at
t=0 and t=D must match. Plan this before animating anything:

- **Continuous motion** — a full 360° rotation or an endlessly translating
  field wraps perfectly with no extra work.
- **Return to base** — scale or position animates back to its starting value,
  and the last beat lands exactly on the starting frame.
- **Fade through** — fade in over the opening beat, hold, fade back out to the
  base state over the closing beat so the wrap is a soft dissolve.

A clip shows over `[start, start + duration)` and an end state landing exactly
on its end is never rendered. End the closing tween one frame early
(`start + duration - 1/fps`) so the final visible frame really is the base
state — otherwise the loop is one frame short of closing.

A clip that ends on a different frame than it starts reads as a bug, not a loop.

### 4. Build in HyperFrames

```bash
npx hyperframes init <project-dir>
```

The root `index.html` declares the canvas. Set it to the placement's exact
pixel size — HyperFrames renders at the composition's authored dimensions and
ignores any size you assume:

```html
<div id="root"
     data-composition-id="main"
     data-width="3840" data-height="1646"
     data-duration="8" data-fps="30">
```

Rules that make or break this step:

- Do not hardcode `1920px`/`1080px` on `#root`; style it `width:100%; height:100%`.
- There is no `--resolution` preset for 21:9 or 3:2 — `--resolution landscape-4k`
  is 3840x2160, which is the wrong shape and gets rejected.
- Give the host div, the scene root, and the timeline key the **same id**. A
  mismatch makes each render wait 45 s per scene and then show static frames.
- Use `fromTo`, not `from`, inside a scene — the host re-seeks the scene and
  `from` drifts on seek-back, which is exactly what breaks a loop.
- Fonts must be bundled as files in `assets/fonts/` with `@font-face`; only
  bundled families resolve by name.
- Put text and copy in the composition as variables (`data-var-text`), never
  baked into an image.
- Keep every scene in `compositions/` as its own sub-composition so a single
  beat can be re-rendered.

`references/hyperframes-build.md` has the loop-technique snippets, the check and
snapshot commands, the render flags, and a canvas-to-ffmpeg pipeline to fall
back on when a 3840x1646 browser render is too slow to iterate on. The spec
and the verification are the same either way.

### 5. Generate supporting imagery only when the concept needs it

Photos, illustrations, and atmospheric backgrounds come from image generation.
**Never generate app UI with an image model** — it hallucinates interfaces, and
a fake UI in a store listing is worse than no UI. Use real screenshots for the
app; use generation for everything around it.

```bash
mcode-tools connector tools --keyword image
mcode-tools connector tool <tool_name>          # read the input_schema first
mcode-tools connector call <tool_name> --args '{"prompt":"...","aspect_ratio":"21:9"}'
```

`references/asset-generation.md` has the full discovery and call flow plus how
to prompt for a specific aspect ratio.

### 6. Check, snapshot, preview — then render

```bash
npx hyperframes check --json                                  # must be clean
npx hyperframes snapshot --at 0,4,8                            # read the PNGs
npx hyperframes preview --background                           # give the user the URL
```

Look at the snapshots before showing the preview. Pass checks alone do not mean
the frame looks right.

Render only after the user has seen the preview and approved it, or when they
asked for the file with no stops:

```bash
npx hyperframes render --quality delivery --fps 30 --format mp4 --output out/<name>.mp4
```

Add `--video-frame-format png` when the source is a screen recording of the
app, so UI text and flat colours survive the frame extraction.

**Iterate on snapshots, render once.** A single-frame snapshot is
near-instant, so judge the composition with
`npx hyperframes snapshot --at 0,4,7.9` and read the PNGs. A full 3840x1646
delivery render of 8 seconds takes about **9 seconds** on an M-series Mac —
the render is not the slow part, the iteration is. Render once the frames
look right.

**Render the test at delivery quality, or re-encode it before trusting the
seam verdict.** A draft-quality render carries quantisation noise, and the
encoder's noise on the final frame differs from its noise on the first frame.
That shows up as a wrap difference that is not geometry, and you will end up
chasing a bug that is not there. If a small test came from `--quality draft`,
re-encode it the way the conform script would (`libx264 -crf 18 -pix_fmt
yuv420p`) and verify that.

### 7. Conform the file to the spec

Run this even after a HyperFrames render. Wrong frame rate and wrong pixel
size are the two rejection reasons people hit first.

```bash
node <skill-dir>/scripts/conform-video.mjs --in out/header.mp4 --out out/<app>-header.mp4 --placement header
node <skill-dir>/scripts/conform-video.mjs --in out/search.mp4 --out out/<app>-search.mp4 --placement search
```

Each placement needs its own composition and its own render. The header canvas
is 21:9 and the search canvas is 3:2 — cropping one into the other throws the
composition away and lands the subject off-frame. Conform fixes resolution,
frame rate and codec; it cannot fix a composition built for the wrong shape.
Set the search composition's root to `data-width="3840" data-height="2560"`.

**One project root per placement.** The root composition declares the canvas,
so the two placements cannot share a root. Give each its own project folder
with its own `index.html` and a copy of the assets — `check` and `snapshot`
only look at the root, and `render --composition <file>` renders a standalone
composition file.

The script scales and crops to the exact canvas, forces a constant 30 or 60
fps, encodes H.264 `yuv420p` (no alpha), strips audio, and sets `faststart`.
It refuses to upscale silently and says so when the source is too small.

### 8. Verify before handing off

```bash
node <skill-dir>/scripts/verify-video.mjs out/<app>-header.mp4 --placement header
node <skill-dir>/scripts/verify-video.mjs out/<app>-search.mp4 --placement search
```

The script checks dimensions, aspect, frame rate (constant, exactly 30 or 60),
duration, codec, pixel format, and audio. It also judges the loop seam: it
compares the first frame against the last frame *relative to the clip's own
typical frame-to-frame motion*, so a wrap that is more disruptive than an
ordinary frame step is reported as a visible jump. It writes a `*-seam.png`
strip of both frames for eyeballing. **It must exit 0.** Fix the composition
and re-render if it does not.

Then pull the poster frame out and look at it on its own — this is the still
the store shows before playback starts, so if it needs a caption to make sense,
the video needs work. Pick the strongest frame, which is not necessarily the
first one:

```bash
ffmpeg -v error -y -ss 00:00:04.000 -i out/<app>-header.mp4 -frames:v 1 out/<app>-poster.png
```

Report the timecode you chose. Poster frames are set on the asset in Asset
Library and **cannot be edited after the asset is approved**, so the choice
has to be made before submitting.

### 9. Hand off

Give the user:

- the final file path(s), one per placement
- the verification report
- the poster frame, and which frame it is
- the publishing steps

A creative asset has to pass three separate gates — uploaded, approved, and
placed — and approval alone does not publish it. `references/publishing.md`
has both routes with the exact `asc` commands:

```bash
asc asset-library view --app APP_ID                     # find the library id
asc asset-library videos upload --library-id ID --file ./header.mp4
asc asset-library videos set-poster-frame --id VIDEO_ID --time-code 00:00:04:00
asc localizations list --app APP_ID                     # find the localization id
asc localizations placements create --localization-id LOC --video-id VID \
  --placement-type PRODUCT_PAGE_HEADER_ASSET           # or APP_STORE_SEARCH_RESULTS_ASSET
```

For an app that is already live, the short version in App Store Connect is:
Apps → your app → sidebar → **Asset Library** → **+** → **Upload Creative
Assets** → upload both files → set a poster frame → **Add for Review** →
**Submit for Review** → wait for **APPROVED** → the **live version** →
**Product Page Information → "Header and Search Results"** → **Browse
Assets** → pick the asset → **Next** → **Publish**. That goes live with no new
version and no new review. If the app has no live version yet, attach the
assets to the next version instead and submit that.

Tell the user to check the result with **Preview** in the Header and Search
Results tab — it shows the asset on iPhone and iPad, across orientations,
languages, and Dark Mode, and the crop differs per placement. Poster frames
cannot be edited after the asset is approved, so pick one before submitting.

Stop there. Do not run the upload, the review submission, or the publish
yourself. Uploading and publishing are the user's steps.

## Output contract

- `out/<app>-header.mp4` — 3840x1646, H.264 `yuv420p`, constant 30 or 60 fps,
  5–30s, no alpha, no audio, under 500 MB
- `out/<app>-search.mp4` — 3:2 within 1920x1280–3840x2560, same encoding rules
- a verification report with every check PASS
- a poster frame, and its timecode
- a short handoff note with the publishing steps from
  `references/publishing.md`

Both placements get their own file. Do not hand over one file for both.

## Failure handling

| Symptom | What to do |
|---|---|
| `ffprobe` / `ffmpeg` not found | `brew install ffmpeg` (macOS) or `choco install ffmpeg` (Windows); the scripts need them to check and conform |
| HyperFrames cannot start Chrome | `npx hyperframes browser ensure`, then `npx hyperframes doctor --json` and check `.ok` |
| Render feels slow | It usually is not. A 3840x1646, 8 s delivery render measures around 9 s on an M-series Mac. If it really is crawling, check that the renderer has GPU workers, and iterate on `hyperframes snapshot` frames instead of re-rendering. `--quality looks` is faster than `--quality delivery` if you only need a look |
| The encoder tags the file with level 4.1 | Both canvases exceed the level 4.1 macroblock ceiling — 3840x1646 is 24720 macroblocks and 1920x1280 is 9600, against a limit of 8192. Re-encode with `-level 5.1` |
| Seam check fails | Fix the last beat so the state returns to the base state. A crossfade (`--seam-crossfade`) is a fallback, not a fix, because it eats `C` seconds of content |
| Text is unreadable at thumbnail size | Enlarge it. Apple notes assets appear differently across the store, so the smallest rendering is the real test |
| Upload rejected in App Store Connect | Re-run `verify-video.mjs` on the file that was actually uploaded, not on the local original. `asc asset-library videos upload` also validates the file against Apple's live spec before it uploads, so its error names the rule you missed |
| Apple rejects the placement | The slot may already be taken — creating a placement does not replace an existing one. Use `asc localizations placements swap` to swap the asset in |
| The asset is rejected by App Review | Read `stateDetails` on the asset. Guideline 2.3.14 is the usual reason — a brand animation must not imply features the app does not have |
| User asks the skill to upload or publish | Decline politely and give the App Store Connect steps. The skill prepares; the user publishes |

## Examples

**Input:** "Make a looping header video for Timmly — a calm morning-coffee
moment. Header and search results."

**Output:** `out/timmly-header.mp4` (3840x1646) and `out/timmly-search.mp4`
(3840x2560) — two separate compositions, not one cropped into two — both
verified PASS, plus the `asc` upload commands and the App Store Connect path.
The concept is one idea — the ritual of the first coffee — rendered as brand
motion with real app screens for the payoff beat, looping so the closing frame
returns to the opening frame.

**Input:** "I recorded 14 seconds of my app on my phone. Can it be an App Store
header?"

**Output:** conformed to 3840x1646 at 30fps, trimmed to 10s, verified. The
report flags that a 19.5:9 phone recording cropped to 21:9 loses edges, so
the user should check the important UI stays inside the safe area.

## Windows (win32) platform notes

The Node scripts (`conform-video.mjs`, `verify-video.mjs`) run unchanged on
Windows. Install the tools with `choco install ffmpeg` and `npm i -g
hyperframes`. HyperFrames commands are identical. In PowerShell, run the
scripts with `node <skill-dir>\scripts\conform-video.mjs --in ...` — the `--`
flags are the same, and `ffmpeg`/`ffprobe` must be on `PATH` (reopen the shell
after installing).
