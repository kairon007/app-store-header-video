# app-store-header-video

A Mavis/Claude skill that builds the two App Store **creative asset** videos —
the looping product page header and the search results header — renders them at
Apple's exact spec, and verifies them before you upload.

| Placement | Aspect | Size | FPS | Length |
|---|---|---|---|---|
| Product page header | 21:9 | exactly 3840×1646 | 30 or 60 | 5–30 s |
| Search results | 3:2 | 1920×1280 – 3840×2560 | 30 or 60 | 5–30 s |

Both placements autoplay muted and loop forever, so the skill treats the loop
as the design constraint: the state at the end of the clip has to equal the
state at the start, or the restart reads as a bug.

## Install

```bash
npx skills add kairon007/app-store-header-video
```

Or copy the folder into your agent's skills directory:

```
~/.minimax/skills/app-store-header-video/
~/.claude/skills/app-store-header-video/
```

## What it does

1. **Locks the placement** against Apple's live asset reference data
   (`asc asset-library specs`), and reads the creative-asset vs app-preview
   distinction so the wrong asset type never gets built.
2. **Picks one idea** and a poster frame — a still that works on its own.
3. **Designs the seam** — the loop is the brief, not a clip.
4. **Builds in HyperFrames** (HTML to video), with the contract rules that
   silently break a render.
5. **Generates supporting imagery** only when the concept needs it, and never
   generates app UI — image models hallucinate interfaces.
6. **Renders**, then conforms and verifies the file.
7. **Hands off** the upload commands. It never publishes anything.

## The scripts

Two Node scripts, no third-party dependencies, ffmpeg only.

```bash
# conform any clip to Apple's spec
node scripts/conform-video.mjs --in ./raw.mp4 --out ./header.mp4 --placement header
node scripts/conform-video.mjs --in ./raw.mp4 --out ./search.mp4 --placement search

# check a file against the spec, including the loop seam
node scripts/verify-video.mjs ./header.mp4 --placement header
```

`verify-video.mjs` checks the container, exact dimensions, constant frame rate
(exactly 30 or 60 — 29.97 is rejected), duration, codec, pixel format, audio,
and the 500 MB cap. It exits non-zero on any hard failure.

It also judges the **loop seam**. The wrap between the last frame and the first
is compared against the clip's own typical frame-to-frame motion, so the check
judges fairly whether the footage is busy or still, and whether the loop
decelerates into its wrap. It writes a `*-seam.png` strip of the first and last
frames so you can eyeball the result.

```
[PASS] resolution     3840x1646 (exact)
[PASS] frame rate     30 fps, constant
[PASS] loop seam      the wrap is as smooth as the clip's own motion — wrap 44.7 dB vs 42.7 dB of typical frame-to-frame motion
[PASS] file size      4.5 MB (Apple allows up to 500 MB)
```

`conform-video.mjs` takes any source and produces a file Apple accepts: exact
canvas, constant frame rate, H.264 `yuv420p`, no alpha, no audio, `faststart`.
It refuses to upscale silently and says so when the source is too small.

## Requirements

- **Node 18+**
- **ffmpeg** with `ffprobe` — `brew install ffmpeg` / `choco install ffmpeg`
- **HyperFrames** for the render step — `npx hyperframes init <dir>`
- Optionally the **`asc` CLI** for reading Apple's live spec and uploading

## Publishing

The skill prepares files and stops. Creative assets pass three separate gates —
uploaded, approved, and placed — and approval alone does not publish anything.
`references/publishing.md` has both App Store Connect routes and the exact
`asc` commands.

Note the difference between the two asset types:

- **Creative asset** (this skill): the header and search videos. They may
  highlight brand or content, do not have to show the app in use, and can be
  approved standalone and published without a new app version.
- **App preview**: the classic screen-recording video in the media row.
  Different sizes (886×1920), 15–30 s, max 30 fps, and an audio track is
  required. Not built here.

## Layout

```
SKILL.md                     the procedure
references/
  specs.md                   Apple's spec tables, safe areas, asset types
  hyperframes-build.md       canvas config, loop techniques, the HyperFrames contract
  publishing.md              both publishing routes and the asc CLI commands
  asset-generation.md        reusing the app's own art, and image generation
scripts/
  conform-video.mjs          conform any clip to Apple's spec
  verify-video.mjs           verify a file, including the loop seam
```

## License

MIT — see [LICENSE](LICENSE).
