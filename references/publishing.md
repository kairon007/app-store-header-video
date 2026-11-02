# Getting the asset live

A creative asset has to pass through three separate states before anyone sees
it. Confusing them is the most common way this stalls:

1. **Uploaded** — the file is in Asset Library and processed.
2. **Approved** — App Review accepted it.
3. **Placed and published** — it is attached to the header or search results
   placement on a live version.

Approval alone does not publish anything.

## Which route to take

| Situation | Route |
|---|---|
| The app is already live | Standalone Asset Library submission, then publish on the live version — no new version, no new review |
| The app has no live version yet | Attach the assets to the first version and submit that |

## Route A — the app is already live (recommended)

Upload and submit the assets on their own, then publish them on the live
version. A standalone submission is reviewed against your app's latest
version, and does not require an app update.

1. **Apps** → your app → sidebar → **Asset Library**.
2. Click **+** → **Upload Creative Assets**.
3. Select the files and click **Upload**. Both placements need their own file.
4. Set a **poster frame** on each asset. This is the still people see before
   playback starts, and **poster frames cannot be edited after the asset is
   approved**.
5. Click **Edit**, select the assets, choose **Add for Review**, create a draft
   submission, and **Submit for Review**. Account Holder, Admin, App Manager, or
   Marketing role is required.
6. Wait for **APPROVED**.
7. **Apps** → your app → sidebar → the **live version** → **Product Page
   Information** → **Header and Search Results** tab → **Header** →
   **Browse Assets** → pick the approved asset → **Next** → **Publish**.
8. Repeat for **Search Results**.

The product page updates on the App Store straight away, with no new version
and no further review.

## Route B — attach to the next version

1. Apps → your app → the app version.
2. **Product Page Information** → **Header and Search Results** tab → **Header**
   or **Search Results**.
3. Drag the image or video into the well, or click **Browse Assets** to reuse
   something already in Asset Library.
4. Set the poster frame, click **Save**.
5. Use **Preview** to check it.
6. Submit the version for review as usual. The creative assets go live when
   that version is approved and released.

## Preview before you publish

The preview tool in the **Header and Search Results** tab shows the asset on
iPhone and iPad, across orientations and languages, and in Dark Mode, for both
the product page and search results. The asset is cropped differently in each
place, so this is the only reliable check that nothing important is clipped.

## Asset states

```
AWAITING_UPLOAD → UPLOAD_COMPLETE → PREPARE_FOR_SUBMISSION
                → READY_FOR_REVIEW → WAITING_FOR_REVIEW → IN_REVIEW
                → ACCEPTED → APPROVED
```

`FAILED` means processing did not succeed — read `stateDetails`.
`REJECTED` means App Review declined it. `ARCHIVED` means an approved asset was
retired from active use. Removing an asset from a placement keeps it in the
library; only assets that have not been submitted can be deleted.

## Rules worth knowing

- "Use header asset in search results" only works for a **universal** asset —
  a 16:9 PNG at 5244x2950. For video you need two dedicated files.
- Creative assets only appear for apps running **iOS 27 / iPadOS 27 or later**.
- They sit alongside screenshots and previews; they do not replace them.
- You can set different assets per localization.
- App Review guideline **2.3.14** applies — a brand animation must not imply
  features the app does not have.
- Creative assets can be tested with product page optimization. Change one
  placement at a time, or you will not know which change moved the number.

## Doing it with the `asc` CLI

The same flow, scripted. `asc` reads Apple's live asset reference data, so
use it to check the numbers have not moved since this skill was written.

```bash
asc asset-library specs --output json > specs.json
```

To pull out just the creative-asset video specs:

```bash
jq -r '
  .data[].attributes.videoSpecs[]
  | select(.compatiblePlacementTypes | any(. == "PRODUCT_PAGE_HEADER_ASSET" or . == "APP_STORE_SEARCH_RESULTS_ASSET"))
  | {shortName, aspectRatio, dimensions, frameRates, duration, maxFileSize, audioRequired}
' specs.json
```

### Upload

```bash
asc asset-library view --app APP_ID --output table     # find the library id

asc asset-library videos upload \
  --library-id LIBRARY_ID \
  --file ./header.mp4 \
  --category CREATIVE_ASSETS \
  --reference-name "Breathwork header en-US"
```

- `--category` defaults to `CREATIVE_ASSETS`, which is what a header and a
  search-results asset both are.
- `asc` runs ffprobe on the file first and refuses anything that misses
  Apple's dimensions, frame rate, duration, audio, or file-size rules.
- Processing takes 10–15 minutes. `ASC_UPLOAD_TIMEOUT` bounds it (default
  30 minutes).
- If it fails after the upload is reserved, the command still prints the video
  ID so you can look the asset up instead of re-uploading.

### Set the poster frame

```bash
asc asset-library videos set-poster-frame \
  --id VIDEO_ID \
  --time-code 00:00:04:00
```

Timecode is `HH:MM:SS:FF` or `HH:MM:SS.mmm`. Pick the frame that carries the
message on its own. Changing it affects every placement using the video, and
it cannot be edited once the asset is approved.

### Place it

```bash
asc localizations list --app APP_ID --output table      # find the localization id

asc localizations placements create \
  --localization-id LOC_ID \
  --video-id VIDEO_ID \
  --placement-type PRODUCT_PAGE_HEADER_ASSET
```

Use `APP_STORE_SEARCH_RESULTS_ASSET` for the search card.

- Creative assets use the `DEFAULT_PROFILE` placement group; screenshots and
  previews need a device group such as `IPHONE_DUO_PROFILE`.
- Apple validates media compatibility and slot availability.
- Creating a placement does **not** submit anything for review, does not
  publish, and does not remove an asset already in that slot. To replace one,
  use `asc localizations placements swap --localization-id LOC --placement-type
  PRODUCT_PAGE_HEADER_ASSET --new-video-id NEW_VIDEO_ID`.

### Confirm

```bash
asc localizations placements list --localization-id LOC_ID --output table
asc asset-library videos placements --id VIDEO_ID --output table
```

Nothing in the CLI submits for review or publishes. Those steps stay with the
user.
