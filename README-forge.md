# Forge media — cars + alphabet

Everything is driven by `forge.json`. Edit that one file; no HTML changes needed.

## Folders to create

```
images/forge/cars/        car still images + video posters
images/forge/alphabet/    letter thumbnail images
videos/cars/              car MP4s (H.264)
videos/alphabet/          letter MP4s (H.264)
```

Paths in `forge.json` are relative to `index.html`, so keep the site root as the base.

## Cars — a mixed gallery

Each entry is either an image or a looping video.

```json
{ "type": "image", "image": "images/forge/cars/render-01.jpg", "alt": "..." }
{ "type": "video", "video": "videos/cars/wheel-loop.mp4", "poster": "images/forge/cars/wheel-loop.jpg", "alt": "..." }
```

- **Video cells** autoplay a muted loop at rest.
- **`"poster"`** is the still shown before the video loads — always provide one, or the cell is blank while loading.
- **`"span": "wide"`** makes a cell take two columns — use it for hero shots.
- Any cell with a `video` opens it (with sound) in the Forge lightbox on click. A play badge appears on hover to signal this.

## Alphabet — thumbnail + hover video

```json
{ "char": "A", "image": "images/forge/alphabet/a.jpg", "video": "videos/alphabet/a.mp4" }
```

- **At rest:** the thumbnail image.
- **On hover:** the video plays inline (muted loop). It loads only on first hover, so 26 videos don't slow the page.
- **On click:** the video opens full-size in the Forge lightbox, with sound.
- **On touch devices** (no hover): the thumbnail shows, and tapping opens the video. Hover-play is desktop-only by design.

Add as many letters as you like — the grid extends automatically.

## Video format

Export **MP4 (H.264 / "baseline" or "main" profile), yuv420p**. That plays in every browser. Avoid `.mov`, HEVC, or 4:4:4 — they fail silently in some browsers.

Keep the hover loops short and small (a few seconds, ideally under ~2 MB each) — they load on hover, so large files feel laggy. The full-size version in the lightbox can be higher quality.

## Posters (recommended)

For every video, add a matching still as its poster/thumbnail. Without one, the cell is empty until the video loads. A quick way to generate posters from your MP4s:

```
ffmpeg -i videos/alphabet/a.mp4 -vframes 1 images/forge/alphabet/a.jpg
```
