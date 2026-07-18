# Chroma photo pipeline

Chroma displays your photographs sorted into a rainbow gradient (by hue, then
dark→light within each colour, with greyscale grouped at the end) and lets
visitors filter by tag. The sort and the colour data are computed
automatically from the images — you never place photos by hand.

## One-time setup

Two ways to run the build — pick whichever you have installed.

**With Node.js:**

```
npm install sharp
```

`sharp` is only used by the build script on your own machine. It is never
sent to visitors.

**Without Node.js (Windows):** nothing to install — `build-photos.ps1` uses
.NET's built-in `System.Drawing`, already present on Windows.

## Adding / updating photos

1. Drop your photos into `images/chroma/`
   (`.jpg`, `.jpeg`, `.png`, `.webp` — plus `.avif` if using the Node script).

2. Run the build:

   ```
   node build-photos.js
   ```

   or, without Node:

   ```
   powershell -File build-photos.ps1
   ```

   This reads every image, extracts its overall colour and brightness, and
   writes `photos.json` — the file the site reads. Photos come out sorted
   rainbow-by-hue automatically.

   It also generates web-sized thumbnails into `images/chroma/thumbs/`. The
   grid loads these thumbnails (not your full-resolution originals), which is
   what keeps the page fast even with 100+ photos. Your originals are left
   untouched and their paths are kept in `photos.json` (the `src` field) for a
   future full-size lightbox. Upload the `thumbs/` folder along with
   everything else.

3. Reload the site. Chroma is populated.

That's the whole loop. Re-run the build any time you add photos.

## Viewing locally

Open the site through a local server, not by double-clicking `index.html`.
Browsers block `fetch()` of local files under the `file://` protocol, so
`photos.json` won't load that way and the Chroma section will stay empty.
Any static server works — e.g. the VS Code "Live Server" extension, or
`npx serve` if you have Node.

## Tags

The build auto-detects three tags from the pixels:

- **black & white** — low colour saturation throughout
- **night** — overall dark image
- **bright** — overall light / high-key image

Everything else (sky, people, animals, event, …) you add by hand, once:

1. Open `photos.json`.
2. Find a photo (identified by its `src`, e.g. `images/chroma/photo-034.jpg`).
3. Add words to its `tags` array:

   ```json
   "tags": ["night", "sky", "people"]
   ```

4. Save. Reload the site — a filter chip appears automatically for every tag
   you've used, with a live count.

Your hand-added tags are **preserved** when you re-run the build, so tagging
is never lost. You can add photos and re-build without redoing work.

You can also give a photo real alt text for accessibility/SEO by setting its
`"alt"` field — otherwise the site falls back to a generic description built
from the photo's tags.

## How the pieces fit

| File                | Role                                                          |
|---------------------|----------------------------------------------------------------|
| `images/chroma/`    | your source photographs                                      |
| `build-photos.js`   | run locally with Node; extracts colour, writes `photos.json` |
| `build-photos.ps1`  | same thing, no Node required (Windows)                        |
| `photos.json`       | generated manifest the site reads (colour data + your tags)  |
| `script.js`         | renders tiles + the tag filter chips from the manifest       |

## Hosting

Everything is relative-path, so the site works the same locally and on any
static host (Firebase Hosting, Netlify, GitHub Pages, …). Just upload the
whole folder including `images/chroma/` and `photos.json`. You do **not**
upload `node_modules/` or run anything on the server — `photos.json` is
already built.

If you later move images to a CDN, change the `src` values in `photos.json`
(or adjust the `src` line in `build-photos.js` / `build-photos.ps1`) to point
at the CDN URLs.
