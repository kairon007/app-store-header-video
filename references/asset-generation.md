# Generating supporting imagery

Only the imagery *around* the app should be generated. Real product material
comes from real captures.

**Never generate app UI with an image model.** They hallucinate interfaces —
invented buttons, fake numbers, wrong typography. A fabricated UI in a store
listing reads as a broken app. Use a simulator or device screenshot for
anything the user will read as product.

| Subject | Source |
|---|---|
| App screens, device frames, product UI | real screenshots |
| Logo, app icon, wordmark | the brand's own files |
| Atmospheric background, texture, illustration | generate |
| Supporting object (mascot, product shot, scenery) | generate, ideally with the app screenshot as a style reference |

## Reusing the app's own art instead of generating

Before generating anything, look for art the app already has: marketing
renders, 3D product animations, mascot loops, onboarding illustrations. Real
art beats generated art, and it costs nothing.

Most app art ships as a **short video of the 3D render on a flat background**.
Extract the best frame, then key that background out so the subject can float
on the composition's own field:

```bash
# pick the frame
ffmpeg -v error -y -i assets/clip.mp4 -vf "select=eq(n\,95),scale=1920:1440:flags=lanczos" -frames:v 1 assets/hero.png

# sample the background colour from a corner first
ffmpeg -v error -i assets/hero.png -vf "crop=1:1:10:10,format=rgb24" -f rawvideo - | xxd -p -c 3

# key it out
ffmpeg -v error -y -i assets/hero.png -vf "colorkey=0xdbf6fb:0.10:0.06" -c:v png -pix_fmt rgba assets/hero-keyed.png
```

- The background of a 3D render is rarely pure white — sample it, it is often
  a pale cyan or a soft gradient.
- Check the key by compositing the result over a strong colour. If any
  background survives, the key is too tight; if the subject's pale panels turn
  transparent, loosen it. A render with white panels on a pale background
  survives `colorkey` at similarity 0.10.
- Keyed art removes the rectangle of the source frame, which is otherwise the
  most visible flaw when a still sits on a gradient.
- Scale the frame up with Lanczos before keying so the browser does not scale
  a tiny source.

A video clip of the same art is worth keeping for a background, but check it
loops before using it: most product animations progress and do not return to
their starting frame. `verify-video.mjs` will tell you — and if it does not
loop, a still plus a CSS float driven by a periodic function is usually the
better answer anyway.

## Generating

Load the `mcode-tools-master` skill before running any `mcode-tools` command.

```bash
mcode-tools connector tools --keyword image
mcode-tools connector tool <tool_name>              # read input_schema + output_schema
mcode-tools connector call <tool_name> --args '{"prompt":"...","aspect_ratio":"21:9"}'
```

- `connector tools --keyword image` searches names and descriptions. If it
  returns nothing relevant, broaden the keyword (`photo`, `generate`, `visual`)
  or run `mcode-tools connector tools` once without a filter.
- Never guess field names. Read `input_schema` and construct the arguments from
  it; on a validation error, re-read the schema instead of inventing fields.
- Use `--args` for small payloads and `--args-file <path>` for anything with
  quotes or many fields.
- A non-zero exit means the call failed — surface the error code and message
  rather than retrying with different fields.
- Generation commands can run long: pass the Bash `timeout: 600` field, not a
  `--timeout` argument (the connector call has no timeout option).

The result comes back as JSON described by the tool's `output_schema`. Save the
image into the HyperFrames project's `assets/` folder under a stable name and
reference it as `assets/<name>` (no leading slash).

## Prompting for a specific aspect

The header canvas is 21:9 and the search canvas is 3:2. Asking for the aspect
ratio in the prompt matters, because a generated image is cropped to fit the
composition and a wrong shape loses the subject.

```
Subject + setting + style + lighting + composition + technical
```

Example for a 21:9 header background:

```
Soft dawn light across a single pour-over coffee setup on a pale oak counter,
steam rising, warm cream and deep espresso brown palette, soft directional
light from the left, shallow depth of field, calm editorial photography,
wide cinematic composition with clear empty space on the right third,
21:9 aspect ratio, 4K
```

Rules that matter here:

- Name the aspect ratio explicitly, and say where the empty space is if text
  goes on top.
- Say what style it is — "editorial photography", "flat illustration",
  "3D render", "paper cutout". Without it the model picks.
- Do not ask for text in the image. Models render text badly, and the text has
  to be a HyperFrames variable anyway so it can be localised and swapped.
- For a brand that already has imagery, use the brand's own assets as the
  reference rather than describing them in words.
- Generate more variants than you need and pick deliberately; the first result
  is rarely the one to ship.

## Keeping the set consistent

When several stills appear in one video, generate them together in one batch
with the same prompt stem so the palette and lighting stay aligned, and put
them through the same treatment before use. A visible mismatch between two
stills in the same loop reads as a mistake.

## Using generated stills in the loop

A still image is a fine subject for a loop — animate it with scale, parallax,
or a light sweep rather than cutting it away. Keep motion continuous across
the wrap (see the loop techniques in `hyperframes-build.md`), and remember that
grain, blur, and vignettes on generated footage belong to
`npx hyperframes media-treatment`, not CSS filters.
