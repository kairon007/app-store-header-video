# Building the loop in HyperFrames

HyperFrames renders HTML to video by seeking a paused timeline frame by frame,
so a render is identical every time. That determinism is what makes a clean
loop possible: the frame at t=0 and the frame at t=D are the same authored
state, not two approximations.

The `hyperframes` skill holds the full render contract. This file covers only
what an App Store header needs.

## Canvas

The root `index.html` owns the canvas. Its `data-width` / `data-height` **are**
the output pixel size — HyperFrames lays the page out at those dimensions and
captures at them.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=3840, height=1646" />
</head>
<body>
  <div id="root"
       data-composition-id="main"
       data-width="3840" data-height="1646"
       data-duration="8"
       data-fps="30">
    <!-- scene hosts -->
  </div>
</body>
</html>
```

`#root` is styled `width: 100%; height: 100%` (or `inset: 0`). Never hardcode
`1920px`/`1080px` on it.

| Placement | `data-width` | `data-height` |
|---|---|---|
| Product page header | 3840 | 1646 |
| Search results | 3840 | 2560 |

`data-duration` is the render length in seconds, read once at compile time. A
script that rewrites it afterwards is ignored — author it directly. It is also
the loop length, so an 8-second header is an 8-second timeline whose end state
matches its start state.

`data-fps` is a hint; `render --fps` overrides it. 60fps doubles render time.

### The size trap

There is no `--width` / `--height` on local render, and `--resolution` only
offers landscape (1920x1080), portrait, 4K (3840x2160), and square presets.
3840x2160 is 16:9, not 21:9 — a header rendered that way is the wrong shape
and App Store Connect rejects it. Author the real dimensions.

## Loop techniques

### A. Continuous rotation

The cheapest perfect loop. A full turn ends exactly where it started.

```js
const tl = gsap.timeline({ paused: true });
tl.to("#badge", { rotation: 360, duration: 8, ease: "none" }, 0);
window.__timelines["main"] = tl;
```

### B. Return to base

Animate away, then back to the starting value so the last frame equals the
first.

```js
tl.fromTo("#phone", { scale: 0.9, y: 40 }, { scale: 1, y: 0, duration: 2, ease: "power2.out" }, 0);
tl.to("#phone", { scale: 0.9, y: 40, duration: 2, ease: "power2.in" }, 6);
```

### C. Fade through

Fade in over the opening beat, hold, fade back to the base state over the
closing beat. The wrap becomes a soft dissolve and reads as intentional.

```js
tl.fromTo("#scene", { opacity: 0 }, { opacity: 1, duration: 1, ease: "none" }, 0);
tl.to("#scene", { opacity: 0, duration: 1, ease: "none" }, 7);
```

### D. Periodic field

A field of elements offset by one period, with the whole field translating by
exactly one period over the duration. Each element enters where its neighbour
left, so the wrap is invisible.

```js
// 6 tiles, each 640 wide, offset 640 apart; shift by exactly 6*640 over 8s
tl.to("#field", { x: -3840, duration: 8, ease: "none" }, 0);
```

### E. One periodic driver

The most reliable way to get a seamless loop is to stop hand-tuning tweens and
derive every animated value from **one function of the timeline time** that
has the loop length as its period. If `f(t)` has period D, then `f(0) == f(D)`
by construction, not by luck.

```js
const D = 8;
// A raised cosine over the whole loop: phase(0) === phase(D).
const phase = (t) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / D);

const tl = gsap.timeline({ paused: true });
tl.to({}, {
  duration: D,
  ease: "none",
  onUpdate() {
    const p = this.progress() * D;
    orb.style.transform = `scale(${0.8 + 0.2 * phase(p)})`;
    ripples.forEach((el, i) => {
      const local = (p + i * (D / ripples.length)) % D;
      el.style.opacity = String(phase(local));
    });
  },
});
```

Drive it from the timeline's own progress rather than from discrete tweens, so
nothing can drift out of phase. Every value is a pure function of a time that
wraps at D, which is what makes the loop exact rather than approximately
right.

Whatever the technique, verify it — the seam check in `verify-video.mjs` is
the arbiter, not the intent.

### When the seam fails, look at the text first

Text is the most sensitive element at a loop seam. A headline that is one
frame short of its base position still *looks* right, but its antialiasing
differs from frame 0's, and a viewer watching the loop repeatedly picks that
up before they pick up anything else. Large flat shapes and slow-moving
elements hide subpixel differences; glyph edges do not.

So when the seam check fails, diff the first and last frames and look at the
text regions first. If the difference is concentrated in glyph pixels, the
cause is almost always a tween that ends one frame past where it should — the
`[start, start + duration)` rule above. Fix the timing, not the design.

## Alternative render path: canvas piped to ffmpeg

HyperFrames is the primary path, but a 3840x1646 render is slow and a
HyperFrames scene carries a lot of machinery. When the render time is the
problem, a deterministic canvas pipeline is a good second route:

```bash
node src/render.mjs \
| ffmpeg -y -hide_banner -loglevel warning \
    -f rawvideo -pixel_format rgba -video_size "${W}x${H}" -framerate 30 -i - \
    -c:v libx264 -profile:v high -level 5.1 -pix_fmt yuv420p \
    -preset slow -crf 19 \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -x264-params "keyint=60:min-keyint=30" \
    out.mp4
```

- `@napi-rs/canvas` or `node-canvas` draws each frame in Node and writes raw
  RGBA to stdout; ffmpeg reads the pipe. No temp frames on disk.
- **Set `-level 5.1`.** The macroblock counts here exceed what level 4.1
  allows: 3840x1646 is 240x103 = 24720 macroblocks and 1920x1280 is 120x80 =
  9600, against a level 4.1 ceiling of 8192. ffmpeg warns and the file is
  tagged with an invalid level, which Apple can reject.
- Colour primaries sometimes do not reach the H.264 VUI from the plain flags
  alone. If ffprobe does not report `color_space=bt709`, pass them through
  `-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709` instead.
- A canvas pipeline also gives full control of typography, which is what you
  want when the headline carries the message — use a real font file rather
  than a system default, and check it renders before committing to a render.
- Run the same `verify-video.mjs` check on the result. The route does not
  change the spec.

## Contract rules that bite in this context

- Every timed element needs `class="clip"`, `data-start`, and `data-duration`
  in seconds, and must be visible over `[start, start + duration)`.
- The root's `data-duration` is the render length. Overrun is cut; an early end
  holds the last frame.
- Register the timeline: `window.__timelines["<data-composition-id>"] = tl;`
- No `Date.now()`, unseeded `Math.random()`, network fetches, timers, or
  `repeat: -1`. Everything visible is a function of timeline time.
  (`repeat: -1` would make the loop automatic but breaks the frame-by-frame
  contract — author the return explicitly.)
- Never tween `display`, `visibility`, or `autoAlpha` on a `.clip`; animate a
  child.
- No CSS `transform` on an element GSAP transforms.
- Asset paths are `assets/...` with no leading slash, in sub-compositions too.
- Fonts: only bundled families resolve by name; anything else needs an
  `@font-face` pointing at a file in `assets/fonts/`.
- Text is a variable (`data-var-text`) so copy can change without touching
  layout.
- Grades, grain, blur, and vignettes on footage go through
  `npx hyperframes media-treatment`, never CSS filters.

## Scene structure

One scene per sub-composition, in `compositions/`, each with its own
`<template>` wrapper and styles its root as `#root`. The root `index.html`
holds only scene hosts, media, and audio.

```
project/
├── index.html
├── compositions/
│   ├── opening.html
│   ├── payoff.html
│   └── closing.html
└── assets/
    ├── fonts/
    ├── icons/
    └── screens/
```

### Mounting a scene

In `index.html`:

```html
<div id="intro"
     data-composition-id="intro"
     data-composition-src="compositions/intro.html"
     data-start="0"
     data-duration="4"
     data-width="3840" data-height="1646"></div>
```

In `compositions/intro.html`, everything lives inside `<template>` — styles and
scripts outside it are dropped:

```html
<template>
  <style>
    #root { position: absolute; inset: 0; }
  </style>
  <div id="intro" data-composition-id="intro" data-width="3840" data-height="1646">
    <h1 id="intro-headline" class="clip" data-start="0.4" data-duration="3" data-var-text="headline">
      …
    </h1>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#intro-headline",
      { opacity: 0, filter: "blur(8px)" },
      { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out" },
      0.4);
    window.__timelines["intro"] = tl;
  </script>
</template>
```

Sub-composition rules that break silently:

- **The host id, the scene root id, and the timeline key must be the same
  string.** A host id that differs from its scene's makes each render wait 45 s
  per scene and then show static frames.
- Size the scene root with `inset: 0`, never hard-coded pixels. The canvas is
  `data-width` × `data-height`.
- Keep ids unique across the assembled page — prefix them (`#intro-title`).
  A scene's timeline cannot reach elements outside its file.
- **Use `fromTo`, not `from`, inside a scene.** The host re-seeks the scene
  every time it shows, and `from` records its start state once, so it drifts
  on seek-back. On a loop, that drift is the seam breaking.
- Never `add()` a scene's timeline to the root's — the runtime drives each
  scene itself, and nesting seeks it twice.
- A root child with `data-start` is laid out full-frame by the runtime. An
  untimed full-bleed background needs `position: absolute; inset: 0` or it
  collapses to nothing.

### Fonts

These families are bundled and resolve by name: Inter, Montserrat, Outfit,
Nunito, Oswald, League Gothic, Archivo Black, Space Mono, IBM Plex Mono,
JetBrains Mono, EB Garamond, Playfair Display, Source Code Pro, Noto Sans JP,
Roboto, Open Sans, Lato, Poppins. Common system fonts (Helvetica, Arial,
Times, Menlo) are swapped for the nearest of these.

Any other family needs an `@font-face` in the file that uses it, or lint fails
`font_family_without_font_face`:

```css
@font-face {
  font-family: "Brand Display";
  src: url('assets/fonts/brand-display.woff2');
}
```

### Loop-critical timing rules

- **A clip shows over `[start, start + duration)` — an end state landing
  exactly on its end is never rendered.** A tween that returns to the base
  state exactly at the clip's end never shows that base state, so the last
  frame is one frame short of where you think it is. End the closing tween at
  `start + duration - 1/fps`, or extend the clip's `data-duration` by one
  frame, so the final visible frame lands exactly on the base state.
- Only a composition's root timeline is paused. Timelines nested inside it are
  not. Never call `tl.play()`.
- A host's `data-duration` is the scene's slot. A shorter scene timeline holds
  its last frame; a slot shorter than the scene goes blank when it ends.
- `data-start="intro + 0.5"` starts after `intro` ends (spaces required). A
  typo, a missing id, or a cycle silently resolves to 0 — snapshot anything
  you time that way.
- `npx hyperframes timeline --json` lists every clip with its `absStart`,
  `absEnd`, `file`, and `host`. Read it instead of opening every file.
- `data-no-timeline` on the root of a still composition, so a render does not
  wait for a timeline that will never exist.

## Commands

```bash
npx hyperframes init <dir>                  # scaffold
npx hyperframes lint                        # while writing
npx hyperframes check --json                # the gate: lint, runtime, layout, contrast
npx hyperframes snapshot --at 0,4,8         # read the PNGs under .hyperframes/artifacts/snapshots/
npx hyperframes snapshot --review           # a film: full review pass
npx hyperframes preview --background        # Studio URL for the user
npx hyperframes render --quality delivery --fps 30 --format mp4 --output out/header.mp4
```

`check --json` reports most violations with a `Fix:` line. Fix every error and
weigh every warning. A 3 s+ video with no visible change fails `sweep_static` —
a header that sits still for 8 seconds is a failed asset, not a safe one.

Snapshot the midpoint of every scene, not just the root, or a scene that never
mounted hides from you.

## Render notes for 3840x1646

- This is roughly 6.3 megapixels per frame, but a render is **not** the slow
  part. Measured on an M-series Mac: 3840x1646, 8 s, 240 frames at
  `--quality delivery` came out in **about 9 seconds** — compile 0.7 s,
  capture 4.8 s, encode 2.2 s. The renderer uses GPU workers and captures
  screenshots rather than video frames.
- The time goes into *iterating*, not rendering. A single-frame snapshot is
  near-instant, so check the composition with
  `npx hyperframes snapshot --at 0,4,7.9` and render once the frames look
  right.
- `--video-frame-format png` when the composition carries fine text or flat
  brand colours, so the intermediate encode does not soften them before the
  final pass.
- `--format mov` renders ProRes 4444 **with alpha** by default. App Store
  wants no alpha, so use `--format mp4` and let the conform script handle the
  container.
- The render output is usually already spec-correct. Run the conform script
  anyway — it is cheap, it guarantees H.264 `yuv420p` with no audio, and it
  catches the cases where the render drifted.
- Confirm the rendered duration matches the root `data-duration` with ffprobe
  before declaring it done.
