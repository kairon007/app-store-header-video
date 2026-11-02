# Apple specs — creative assets (product page header + search results)

Source of truth:
<https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/>
Best practices: <https://developer.apple.com/app-store/asset-best-practices/>
Upload path: <https://developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets/>

Re-check these before a release: Apple adds placements and adjusts limits, and
this file is a snapshot.

## Video specifications

| Placement | Aspect | Resolution | FPS | Length | Extensions |
|---|---|---|---|---|---|
| Product page header | 21:9 | 3840 x 1646 px (exact) | 30 or 60 | 5–30 s | .mov, .m4v, .mp4 |
| Search results | 3:2 | min 1920 x 1280, max 3840 x 2560 | 30 or 60 | 5–30 s | .mov, .m4v, .mp4 |

Apple's notes, verbatim in substance:

- Videos are **muted by default in search results and cannot currently be
  unmuted**.
- On the product page videos are muted by default, **but people can unmute them**.
- **Videos loop continuously in both placements.**

From Apple's live asset reference data (`asc asset-library specs`), both video
placements also have a **maximum file size of 500 MB**, and
`audioRequired: false` — a creative asset does not need an audio track, unlike
a classic app preview, where `audioRequired: true`.

There is no universal video size — a header video is not reused for search
results. A universal *image* (16:9 PNG) is the only asset that can serve both
placements ("Use header asset in search results").

## Image specifications (context, not this skill's output)

| Placement | Aspect | Resolution | Extensions |
|---|---|---|---|
| Product page header | 21:9 | 3840 x 1646 | .jpeg, .jpg, .png |
| Product page header | 16:9 | 5244 x 2950 | .png only |
| Search results | 3:2 | 1920 x 1280 to 3840 x 2560 | .jpeg, .jpg, .png |
| Search results | 16:9 | 5244 x 2950 | .png only |

Images cannot include alpha channels or transparency.

## Creative asset vs app preview — do not confuse them

These are different assets with different specs, and mixing them up is the most
common rejection.

| | Creative asset (header / search) | App preview |
|---|---|---|
| What it shows | Brand, content, or the app — it does **not** have to show the app in use | Footage captured on device showing the app being used |
| Length | 5–30 s | 15–30 s |
| Frame rate | 30 or 60 fps | max 30 fps |
| Size | 3840x1646 (header), 3:2 up to 3840x2560 (search) | per device size, e.g. 886x1920 for current iPhones |
| Placement | product page header, search results, in-app events | the media row on the product page, ahead of screenshots |
| Sound | muted by default (search results can never be unmuted); an audio track is optional | muted by default, and an audio track is required |

App preview specs live at
<https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications>.
This skill does **not** make app previews.

Creative assets are optional, sit alongside screenshots and previews rather than
replacing them, and only show to people on iOS 27 / iPadOS 27 or later. If no
search results asset exists, search shows in-app events, previews, or
screenshots.

## Safe areas

Apple defines safe areas in downloadable templates (Figma, Photoshop,
Pixelmator) on the asset best practices page, and in the Preview tool inside
App Store Connect. The rules that follow from them:

- Design key elements with a safe area in mind — the asset is cropped
  differently across devices and orientations.
- Keep the focal point artwork in the **centre** of the composition to prevent
  unwanted clipping.
- Use the whole canvas for the background; keep logos, text, and the main
  subject inside the safe area.
- The App Store Connect Preview tool shows how the asset actually appears
  before it is live. Treat it as the final gate, not an optional nicety.

The product page header sits above the app icon and title, so keep text clear
of the lower-left region where the icon and title are overlaid, and out of the
outer edges.

Apple does not publish safe-area boxes as numbers on the web — they live in
the downloadable templates and in the preview tool. A conservative default that
satisfies Apple's rule of thumb, and that you can start from before you have
the template:

- Let the **background** run full-bleed to every edge.
- Keep the **focal subject** inside the central ~60% of the canvas.
- Keep any **text** inside the central ~80% of the width, and clear of the
  bottom 15% where the product page places the icon and title.

Then download Apple's template for the placement you are building and check
the layout against it, and confirm in the App Store Connect preview tool
before the version is submitted. The crop differs per placement, so a layout
that works for the header is not automatically safe for the search card.

## Craft guidance from Apple's best practices

Videos:

- **Select an impactful poster frame** — the first image someone sees before
  the video plays. It has to represent the app and work on its own.
- **Start strong** — lead with the value proposition or the most compelling
  feature. Avoid quick cuts and fast-moving visuals; give people time to grasp
  what is being shared.
- **Loop seamlessly** — videos autoplay and repeat, so people may see the loop
  many times. No visible jumps or breaks.
- **Use audio mindfully** — audio is muted by default, so the creative must
  work silently first. If audio is added, treat it as brand texture rather
  than information delivery.

Images and general:

- Be intentional with text — a short phrase that enhances the visual, not
  describes it.
- Keep everything legible; assets can appear differently across the App Store.
- Localise for every language the app supports.

Product page header specifically:

- **Focus on a single, clear idea.** Visually dense or cluttered assets dilute
  impact.
- **Design with a first-time visitor in mind** — what is most compelling to
  someone completely new to the app.
- Use product page optimization (PPO) to test alternative header visuals.

## Uploading in App Store Connect

Creative assets live in **Asset Library**, the central place for assets across
platforms, sizes, and placements. There are two routes, and which one you use
depends on whether the app is already live. `publishing.md` has both in full,
with the exact `asc` commands.

- **App already live** — upload and submit the assets standalone from Asset
  Library, then publish them on the live version. No new version, no new
  review.
- **App not live yet** — attach the assets on the version page under Product
  Page Information → Header and Search Results, and submit the version.

In both cases the asset passes through three gates: uploaded, approved, and
placed. Approval does not publish it.
